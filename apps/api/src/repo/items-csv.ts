import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { brands, categories, items, itemVariants, modifierSets, newId, salesTypes, type DbHandle } from "@naqdi/db";
import { barcodeProblem, parseCsvTable, toCsv } from "@naqdi/domain";
import type { AuthContext } from "../auth/tokens";
import { writeAudit } from "./audit";
import { assertItemRefs, createItem, getItem, snapshotItem, updateItem, type ItemInput, type VariantInput } from "./items";

type Db = DbHandle["db"];

export interface ImportIssue {
  line: number;
  code: string;
  field?: string;
  value?: string;
}

export interface ImportReport {
  dryRun: boolean;
  applied: boolean;
  created: number;
  updated: number;
  categoriesCreated: number;
  brandsCreated: number;
  errors: ImportIssue[];
}

const MAX_ROWS = 2000;
const SALES_PREFIX = "price:";

export const exportItemsCsv = async (db: Db, businessId: string): Promise<string> => {
  const sales = await db
    .select()
    .from(salesTypes)
    .where(and(eq(salesTypes.businessId, businessId), isNull(salesTypes.deletedAt)))
    .orderBy(asc(salesTypes.name));
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.businessId, businessId), isNull(items.deletedAt)))
    .orderBy(asc(items.name));
  const cats = new Map(
    (await db.select().from(categories).where(and(eq(categories.businessId, businessId), isNull(categories.deletedAt)))).map((c) => [c.id, c.name]),
  );
  const brs = new Map(
    (await db.select().from(brands).where(and(eq(brands.businessId, businessId), isNull(brands.deletedAt)))).map((b) => [b.id, b.name]),
  );

  const modNames = new Map(
    (await db.select().from(modifierSets).where(and(eq(modifierSets.businessId, businessId), isNull(modifierSets.deletedAt)))).map((m) => [m.id, m.name]),
  );

  const out: Array<Array<string | number | null>> = [
    ["name", "category", "brand", "variant", "sku", "barcode", "price", "cost", "status", "description", "modifiers", "track_stock", ...sales.map((s) => `${SALES_PREFIX}${s.name}`)],
  ];
  for (const { id } of rows) {
    const item = await getItem(db, businessId, id);
    if (!item) continue;
    for (const v of item.variants) {
      out.push([
        item.name,
        item.categoryId ? (cats.get(item.categoryId) ?? "") : "",
        item.brandId ? (brs.get(item.brandId) ?? "") : "",
        v.name,
        v.sku ?? "",
        v.barcode ?? "",
        v.basePrice,
        v.cost,
        item.status,
        item.description ?? "",
        item.modifierSetIds.map((id) => modNames.get(id)).filter(Boolean).join("|"),
        item.trackStock ? "yes" : "no",
        ...sales.map((s) => v.prices.find((p) => p.salesTypeId === s.id)?.price ?? ""),
      ]);
    }
  }
  return toCsv(out);
};

const intOf = (raw: string): number | null => (/^\d{1,13}$/.test(raw) ? Number(raw) : null);

interface ParsedRow {
  line: number;
  name: string;
  category: string;
  brand: string;
  variant: string;
  sku: string | null;
  /** undefined = kolom tidak ada di berkas (jangan diubah); null = sel kosong (biarkan yang ada). */
  barcode: string | null | undefined;
  price: number;
  cost: number | null;
  status: "active" | "inactive" | null;
  description: string | null;
  hasCategory: boolean;
  hasBrand: boolean;
  /** null = kolom tidak ada di berkas (jangan diubah). */
  modifierSetIds: string[] | null;
  trackStock: boolean | null;
  prices: Map<string, number>;
}

/**
 * Impor item dari CSV. Semua-atau-tidak-sama-sekali: bila ada satu baris bermasalah, tidak ada yang disimpan.
 * Kunci pencocokan: SKU bila ada, selain itu nama item + nama varian (tidak peka huruf besar-kecil).
 * Item yang sudah ada diperbarui; varian yang tidak disebut dalam berkas dibiarkan.
 */
export const importItemsCsv = async (db: Db, auth: AuthContext, csv: string, dryRun: boolean): Promise<ImportReport> => {
  const report: ImportReport = { dryRun, applied: false, created: 0, updated: 0, categoriesCreated: 0, brandsCreated: 0, errors: [] };
  const table = parseCsvTable(csv);
  if (table.length === 0) {
    report.errors.push({ line: 1, code: "empty_file" });
    return report;
  }
  if (table.length > MAX_ROWS) {
    report.errors.push({ line: 1, code: "too_many_rows", value: String(MAX_ROWS) });
    return report;
  }

  const headers = Object.keys(table[0]!.values);
  for (const required of ["name", "price"]) {
    if (!headers.includes(required)) report.errors.push({ line: 1, code: "missing_column", field: required });
  }
  const sales = await db
    .select()
    .from(salesTypes)
    .where(and(eq(salesTypes.businessId, auth.businessId), isNull(salesTypes.deletedAt)));
  const salesByName = new Map(sales.map((s) => [s.name.toLowerCase(), s.id]));
  const priceColumns = headers.filter((h) => h.startsWith(SALES_PREFIX));
  for (const col of priceColumns) {
    if (!salesByName.has(col.slice(SALES_PREFIX.length).trim())) report.errors.push({ line: 1, code: "unknown_sales_type", field: col });
  }
  if (report.errors.length) return report;

  const modByName = new Map(
    (await db.select().from(modifierSets).where(and(eq(modifierSets.businessId, auth.businessId), isNull(modifierSets.deletedAt)))).map((m) => [m.name.toLowerCase(), m.id]),
  );
  const hasModifiersCol = headers.includes("modifiers");
  const hasTrackCol = headers.includes("track_stock");

  const rows: ParsedRow[] = [];
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const hasBarcodeCol = headers.includes("barcode");
  const seenKey = new Set<string>();
  for (const { line, values: v } of table) {
    const issue = (code: string, field?: string, value?: string) =>
      report.errors.push({ line, code, ...(field ? { field } : {}), ...(value !== undefined ? { value } : {}) });
    const name = (v.name ?? "").trim();
    if (!name) {
      issue("name_required", "name");
      continue;
    }
    const price = intOf((v.price ?? "").replace(/\s/g, ""));
    if (price === null) {
      issue("price_invalid", "price", v.price);
      continue;
    }
    let cost: number | null = null;
    if ((v.cost ?? "") !== "") {
      cost = intOf(v.cost!.replace(/\s/g, ""));
      if (cost === null) {
        issue("cost_invalid", "cost", v.cost);
        continue;
      }
    }
    let status: "active" | "inactive" | null = null;
    if ((v.status ?? "") !== "") {
      const s = v.status!.toLowerCase();
      if (s !== "active" && s !== "inactive") {
        issue("status_invalid", "status", v.status);
        continue;
      }
      status = s;
    }
    const variant = (v.variant ?? "").trim() || "Reguler";
    const sku = (v.sku ?? "").trim() || null;
    if (sku) {
      const first = seenSku.get(sku);
      if (first !== undefined) {
        issue("sku_duplicate_in_file", "sku", sku);
        continue;
      }
      seenSku.set(sku, line);
    }
    let barcode: string | null | undefined;
    if (hasBarcodeCol) {
      barcode = (v.barcode ?? "").trim() || null;
      if (barcode) {
        if (barcodeProblem(barcode)) {
          issue("barcode_invalid", "barcode", barcode);
          continue;
        }
        if (seenBarcode.has(barcode.toLowerCase())) {
          issue("barcode_duplicate_in_file", "barcode", barcode);
          continue;
        }
        seenBarcode.set(barcode.toLowerCase(), line);
      }
    }
    const key = `${name.toLowerCase()}|${variant.toLowerCase()}`;
    if (seenKey.has(key)) {
      issue("variant_duplicate", "variant", variant);
      continue;
    }
    seenKey.add(key);

    let modifierSetIds: string[] | null = null;
    if (hasModifiersCol) {
      modifierSetIds = [];
      for (const raw of (v.modifiers ?? "").split("|").map((x) => x.trim()).filter(Boolean)) {
        const id = modByName.get(raw.toLowerCase());
        if (!id) {
          issue("unknown_modifier", "modifiers", raw);
          modifierSetIds = null;
          break;
        }
        if (!modifierSetIds.includes(id)) modifierSetIds.push(id);
      }
      if (modifierSetIds === null) continue;
    }

    let trackStock: boolean | null = null;
    if (hasTrackCol && (v.track_stock ?? "") !== "") {
      const t = v.track_stock!.toLowerCase();
      if (["yes", "true", "1", "ya"].includes(t)) trackStock = true;
      else if (["no", "false", "0", "tidak"].includes(t)) trackStock = false;
      else {
        issue("track_stock_invalid", "track_stock", v.track_stock);
        continue;
      }
    }

    const prices = new Map<string, number>();
    let bad = false;
    for (const col of priceColumns) {
      const raw = (v[col] ?? "").replace(/\s/g, "");
      if (raw === "") continue;
      const n = intOf(raw);
      if (n === null) {
        issue("price_invalid", col, v[col]);
        bad = true;
        break;
      }
      prices.set(salesByName.get(col.slice(SALES_PREFIX.length).trim())!, n);
    }
    if (bad) continue;

    rows.push({
      line, name, category: (v.category ?? "").trim(), brand: (v.brand ?? "").trim(), variant, sku, barcode, price, cost, status,
      description: (v.description ?? "").trim() || null,
      hasCategory: headers.includes("category") && (v.category ?? "").trim() !== "",
      hasBrand: headers.includes("brand") && (v.brand ?? "").trim() !== "",
      modifierSetIds,
      trackStock,
      prices,
    });
  }
  if (report.errors.length) return report;

  const groups = new Map<string, ParsedRow[]>();
  for (const r of rows) groups.set(r.name.toLowerCase(), [...(groups.get(r.name.toLowerCase()) ?? []), r]);

  const run = async (tx: Db) => {
    const catIds = new Map<string, string>(
      (await tx.select().from(categories).where(and(eq(categories.businessId, auth.businessId), isNull(categories.deletedAt)))).map((c) => [c.name.toLowerCase(), c.id]),
    );
    const brandIds = new Map<string, string>(
      (await tx.select().from(brands).where(and(eq(brands.businessId, auth.businessId), isNull(brands.deletedAt)))).map((b) => [b.name.toLowerCase(), b.id]),
    );
    const ensure = async (kind: "category" | "brand", name: string): Promise<string> => {
      const map = kind === "category" ? catIds : brandIds;
      const found = map.get(name.toLowerCase());
      if (found) return found;
      const id = newId();
      if (kind === "category") {
        await tx.insert(categories).values({ id, businessId: auth.businessId, name });
        report.categoriesCreated++;
      } else {
        await tx.insert(brands).values({ id, businessId: auth.businessId, name });
        report.brandsCreated++;
      }
      map.set(name.toLowerCase(), id);
      return id;
    };

    const existingItems = await tx
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.businessId, auth.businessId), isNull(items.deletedAt)));
    const itemByName = new Map(existingItems.map((i) => [i.name.toLowerCase(), i.id]));
    const skuOwner = new Map<string, string>(
      (
        await tx
          .select({ sku: itemVariants.sku, itemId: itemVariants.itemId })
          .from(itemVariants)
          .where(and(eq(itemVariants.businessId, auth.businessId), isNull(itemVariants.deletedAt), inArray(itemVariants.sku, [...seenSku.keys()].length ? [...seenSku.keys()] : [""])))
      ).map((r) => [r.sku as string, r.itemId]),
    );

    for (const group of groups.values()) {
      const first = group[0]!;
      const categoryId = first.hasCategory ? await ensure("category", first.category) : undefined;
      const brandId = first.hasBrand ? await ensure("brand", first.brand) : undefined;
      const targetId = itemByName.get(first.name.toLowerCase()) ?? group.map((r) => (r.sku ? skuOwner.get(r.sku) : undefined)).find(Boolean);

      if (!targetId) {
        const input: ItemInput = {
          name: first.name,
          description: first.description,
          categoryId: categoryId ?? null,
          brandId: brandId ?? null,
          status: first.status ?? "active",
          trackStock: first.trackStock ?? false,
          ...(first.modifierSetIds ? { modifierSetIds: first.modifierSetIds } : {}),
          variants: group.map((r): VariantInput => ({
            name: r.variant, sku: r.sku, barcode: r.barcode ?? null, basePrice: r.price, cost: r.cost ?? 0,
            prices: [...r.prices].map(([salesTypeId, price]) => ({ salesTypeId, price })),
          })),
        };
        await assertItemRefs(tx, auth.businessId, input);
        const id = await createItem(tx, auth.businessId, input);
        report.created++;
        await writeAudit(tx, auth, { entityType: "item", entityId: id, action: "import", summary: first.name, changes: { after: snapshotItem((await getItem(tx, auth.businessId, id))!) } });
        continue;
      }

      const before = (await getItem(tx, auth.businessId, targetId))!;
      const merged: VariantInput[] = before.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, barcode: v.barcode, basePrice: v.basePrice, cost: v.cost, prices: v.prices.map((p) => ({ ...p })) }));
      for (const r of group) {
        const at = merged.findIndex((m) => (r.sku && m.sku === r.sku) || m.name.toLowerCase() === r.variant.toLowerCase());
        const overlay = (m: VariantInput): VariantInput => {
          const prices = new Map(m.prices.map((p) => [p.salesTypeId, p.price]));
          for (const [k, val] of r.prices) prices.set(k, val);
          return { ...m, name: r.variant, sku: r.sku ?? m.sku, barcode: r.barcode ?? m.barcode, basePrice: r.price, cost: r.cost ?? m.cost, prices: [...prices].map(([salesTypeId, price]) => ({ salesTypeId, price })) };
        };
        if (at >= 0) merged[at] = overlay(merged[at]!);
        else merged.push(overlay({ name: r.variant, sku: null, barcode: null, basePrice: r.price, cost: 0, prices: [] }));
      }
      const input: ItemInput = {
        variants: merged,
        ...(first.description !== null ? { description: first.description } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(brandId ? { brandId } : {}),
        ...(first.status ? { status: first.status } : {}),
        ...(first.trackStock !== null ? { trackStock: first.trackStock } : {}),
        ...(first.modifierSetIds ? { modifierSetIds: first.modifierSetIds } : {}),
      };
      await assertItemRefs(tx, auth.businessId, input, targetId);
      await updateItem(tx, auth.businessId, targetId, input);
      report.updated++;
      await writeAudit(tx, auth, {
        entityType: "item", entityId: targetId, action: "import", summary: before.name,
        changes: { before: snapshotItem(before), after: snapshotItem((await getItem(tx, auth.businessId, targetId))!) },
      });
    }
  };

  class Rollback extends Error {}
  try {
    await db.transaction(async (tx) => {
      await run(tx as unknown as Db);
      if (dryRun) throw new Rollback();
    });
    report.applied = true;
  } catch (error) {
    if (!(error instanceof Rollback)) {
      const fields = (error as { fields?: Record<string, string> }).fields;
      report.created = 0;
      report.updated = 0;
      report.categoriesCreated = 0;
      report.brandsCreated = 0;
      report.errors.push({ line: 0, code: fields ? "reference_invalid" : "write_failed", ...(fields ? { value: Object.keys(fields).join(",") } : {}) });
    }
  }
  return report;
};
