/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, count, eq, inArray, isNull, like, max, min, ne, or, sql } from "drizzle-orm";
import {
  brands,
  categories,
  itemModifierSets,
  itemOutlets,
  items,
  itemVariantPrices,
  itemVariants,
  modifierSets,
  newId,
  outlets,
  salesTypes,
  type DbHandle,
} from "@naqdi/db";
import { activeOutletIds, contains, missingIn } from "./generic";

type Db = DbHandle["db"];

export interface VariantInput {
  id?: string | undefined;
  name: string;
  sku: string | null;
  /** undefined = biarkan nilai yang ada; null = hapus barcode. */
  barcode?: string | null | undefined;
  basePrice: number;
  cost: number;
  prices: Array<{ salesTypeId: string; price: number }>;
}

export interface ItemInput {
  name?: string | undefined;
  description?: string | null | undefined;
  imageUrl?: string | null | undefined;
  categoryId?: string | null | undefined;
  brandId?: string | null | undefined;
  trackStock?: boolean | undefined;
  status?: "active" | "inactive" | undefined;
  variants?: VariantInput[] | undefined;
  modifierSetIds?: string[] | undefined;
  outletIds?: string[] | undefined;
  allOutlets?: boolean | undefined;
}

export interface FullItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  brandId: string | null;
  trackStock: boolean;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
  variants: Array<{ id: string; name: string; sku: string | null; barcode: string | null; basePrice: number; cost: number; prices: Array<{ salesTypeId: string; price: number }> }>;
  modifierSetIds: string[];
  outletIds: string[];
}

export class RefError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super("refs");
  }
}

/** Memastikan semua id rujukan milik bisnis ini. Melempar RefError berisi galat per bidang. */
export const assertItemRefs = async (db: Db, businessId: string, data: ItemInput, itemId?: string): Promise<void> => {
  const fields: Record<string, string> = {};
  if (data.categoryId && (await missingIn(db, categories, businessId, [data.categoryId])).length) fields.categoryId = "errors.notFound";
  if (data.brandId && (await missingIn(db, brands, businessId, [data.brandId])).length) fields.brandId = "errors.notFound";
  if (data.modifierSetIds && (await missingIn(db, modifierSets, businessId, data.modifierSetIds)).length) fields.modifierSetIds = "errors.notFound";
  if (data.outletIds) {
    if ((await missingIn(db, outlets, businessId, data.outletIds)).length) fields.outletIds = "errors.notFound";
  }
  if (data.variants) {
    const saleIds = data.variants.flatMap((v) => v.prices.map((p) => p.salesTypeId));
    const badSales = new Set(await missingIn(db, salesTypes, businessId, saleIds));
    const skus = data.variants.map((v) => v.sku).filter((s): s is string => Boolean(s));
    const barcodes = data.variants.map((v) => v.barcode).filter((s): s is string => Boolean(s));

    data.variants.forEach((v, i) => {
      if (v.prices.some((p) => badSales.has(p.salesTypeId))) fields[`variants.${i}.prices`] = "errors.notFound";
    });

    if (skus.length) {
      const conflicts = await db
        .select({ sku: itemVariants.sku })
        .from(itemVariants)
        .where(
          and(
            eq(itemVariants.businessId, businessId),
            isNull(itemVariants.deletedAt),
            inArray(itemVariants.sku, skus),
            itemId ? ne(itemVariants.itemId, itemId) : undefined,
          ),
        );
      const taken = new Set(conflicts.map((c) => c.sku));
      data.variants.forEach((v, i) => {
        if (v.sku && taken.has(v.sku)) fields[`variants.${i}.sku`] = "catalog.skuDuplicate";
      });
    }

    if (barcodes.length) {
      // Pembandingan kolom MySQL tidak peka huruf besar-kecil, sama dengan indeks unik.
      const conflicts = await db
        .select({ barcode: itemVariants.barcode })
        .from(itemVariants)
        .where(
          and(
            eq(itemVariants.businessId, businessId),
            isNull(itemVariants.deletedAt),
            inArray(itemVariants.barcode, barcodes),
            itemId ? ne(itemVariants.itemId, itemId) : undefined,
          ),
        );
      const taken = new Set(conflicts.map((c) => (c.barcode ?? "").toLowerCase()));
      data.variants.forEach((v, i) => {
        if (v.barcode && taken.has(v.barcode.toLowerCase())) fields[`variants.${i}.barcode`] = "catalog.barcodeDuplicate";
      });
    }

    if (itemId) {
      const own = await db
        .select({ id: itemVariants.id })
        .from(itemVariants)
        .where(and(eq(itemVariants.itemId, itemId), isNull(itemVariants.deletedAt)));
      const ownIds = new Set(own.map((o) => o.id));
      data.variants.forEach((v, i) => {
        if (v.id && !ownIds.has(v.id)) fields[`variants.${i}.id`] = "errors.notFound";
      });
    } else {
      data.variants.forEach((v, i) => {
        if (v.id) fields[`variants.${i}.id`] = "errors.notFound";
      });
    }
  }
  if (Object.keys(fields).length) throw new RefError(fields);
};

export const getItem = async (db: Db, businessId: string, id: string): Promise<FullItem | null> => {
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.businessId, businessId), isNull(items.deletedAt), eq(items.id, id)))
    .limit(1);
  if (!item) return null;
  const variants = await db
    .select()
    .from(itemVariants)
    .where(and(eq(itemVariants.itemId, id), isNull(itemVariants.deletedAt)))
    .orderBy(asc(itemVariants.position), asc(itemVariants.createdAt));
  const prices = variants.length
    ? await db.select().from(itemVariantPrices).where(inArray(itemVariantPrices.variantId, variants.map((v) => v.id)))
    : [];
  const mods = await db.select().from(itemModifierSets).where(eq(itemModifierSets.itemId, id)).orderBy(asc(itemModifierSets.position));
  const outs = await db.select().from(itemOutlets).where(and(eq(itemOutlets.itemId, id), eq(itemOutlets.available, true)));
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    categoryId: item.categoryId,
    brandId: item.brandId,
    trackStock: item.trackStock,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    variants: variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      barcode: v.barcode,
      basePrice: v.basePrice,
      cost: v.cost,
      prices: prices.filter((p) => p.variantId === v.id).map((p) => ({ salesTypeId: p.salesTypeId, price: p.price })),
    })),
    modifierSetIds: mods.map((m) => m.setId),
    outletIds: outs.map((o) => o.outletId),
  };
};

export const listItems = async (
  db: Db,
  businessId: string,
  p: { page: number; pageSize: number; q?: string | undefined; categoryId?: string | undefined; status?: "active" | "inactive" | undefined; outletId?: string | undefined },
) => {
  const where = and(
    eq(items.businessId, businessId),
    isNull(items.deletedAt),
    p.q
      ? or(
          like(items.name, contains(p.q)),
          inArray(
            items.id,
            db
              .select({ id: itemVariants.itemId })
              .from(itemVariants)
              .where(and(eq(itemVariants.businessId, businessId), isNull(itemVariants.deletedAt), or(like(itemVariants.sku, contains(p.q)), like(itemVariants.barcode, contains(p.q))))),
          ),
        )
      : undefined,
    p.categoryId ? eq(items.categoryId, p.categoryId) : undefined,
    p.status ? eq(items.status, p.status) : undefined,
    p.outletId
      ? inArray(items.id, db.select({ id: itemOutlets.itemId }).from(itemOutlets).where(eq(itemOutlets.outletId, p.outletId)))
      : undefined,
  );
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(items).where(where);
  const rows = await db.select().from(items).where(where).orderBy(asc(items.name)).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  const ids = rows.map((r) => r.id);
  const agg = ids.length
    ? await db
        .select({ itemId: itemVariants.itemId, n: count(), lo: min(itemVariants.basePrice), hi: max(itemVariants.basePrice) })
        .from(itemVariants)
        .where(and(inArray(itemVariants.itemId, ids), isNull(itemVariants.deletedAt)))
        .groupBy(itemVariants.itemId)
    : [];
  const catIds = [...new Set(rows.map((r) => r.categoryId).filter((x): x is string => Boolean(x)))];
  const cats = catIds.length
    ? await db.select({ id: categories.id, name: categories.name }).from(categories).where(and(inArray(categories.id, catIds), isNull(categories.deletedAt)))
    : [];
  return {
    total,
    items: rows.map((r) => {
      const a = agg.find((x) => x.itemId === r.id);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        trackStock: r.trackStock,
        imageUrl: r.imageUrl,
        categoryId: r.categoryId,
        categoryName: cats.find((c) => c.id === r.categoryId)?.name ?? null,
        variantCount: Number(a?.n ?? 0),
        minPrice: a?.lo === null || a?.lo === undefined ? null : Number(a.lo),
        maxPrice: a?.hi === null || a?.hi === undefined ? null : Number(a.hi),
        updatedAt: r.updatedAt,
      };
    }),
  };
};

const writeVariantPrices = async (db: Db, variantId: string, prices: Array<{ salesTypeId: string; price: number }>) => {
  await db.delete(itemVariantPrices).where(eq(itemVariantPrices.variantId, variantId));
  if (prices.length) await db.insert(itemVariantPrices).values(prices.map((p) => ({ variantId, salesTypeId: p.salesTypeId, price: p.price })));
};

const writeOutlets = async (db: Db, businessId: string, itemId: string, data: ItemInput, isCreate: boolean) => {
  const touched = data.outletIds !== undefined || data.allOutlets !== undefined;
  if (!touched && !isCreate) return;
  // Item baru tanpa pilihan outlet tersedia di semua outlet ("Save to All Outlets").
  const everywhere = data.allOutlets === true || (isCreate && !touched);
  const ids = everywhere ? await activeOutletIds(db, businessId) : (data.outletIds ?? []);
  await db.delete(itemOutlets).where(eq(itemOutlets.itemId, itemId));
  const unique = [...new Set(ids)];
  if (unique.length) await db.insert(itemOutlets).values(unique.map((outletId) => ({ itemId, outletId, available: true })));
};

const writeModifierSets = async (db: Db, itemId: string, setIds: string[]) => {
  await db.delete(itemModifierSets).where(eq(itemModifierSets.itemId, itemId));
  const unique = [...new Set(setIds)];
  if (unique.length) await db.insert(itemModifierSets).values(unique.map((setId, position) => ({ itemId, setId, position })));
};

/** Menyimpan item baru. Panggil di dalam transaksi. Mengembalikan id item. */
export const createItem = async (db: Db, businessId: string, data: ItemInput): Promise<string> => {
  if (!data.name) throw new Error("nama item wajib untuk membuat item");
  const id = newId();
  await db.insert(items).values({
    id,
    businessId,
    name: data.name,
    description: data.description ?? null,
    imageUrl: data.imageUrl ?? null,
    categoryId: data.categoryId ?? null,
    brandId: data.brandId ?? null,
    trackStock: data.trackStock ?? false,
    status: data.status ?? "active",
  });
  for (const [position, v] of (data.variants ?? []).entries()) {
    const variantId = newId();
    await db.insert(itemVariants).values({ id: variantId, businessId, itemId: id, name: v.name, sku: v.sku, barcode: v.barcode ?? null, basePrice: v.basePrice, cost: v.cost, position });
    await writeVariantPrices(db, variantId, v.prices);
  }
  await writeModifierSets(db, id, data.modifierSetIds ?? []);
  await writeOutlets(db, businessId, id, data, true);
  return id;
};

/** Memperbarui item. Varian yang tidak ada di `data.variants` dihapus (soft delete). Panggil di dalam transaksi. */
export const updateItem = async (db: Db, businessId: string, id: string, data: ItemInput): Promise<void> => {
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "description", "imageUrl", "categoryId", "brandId", "trackStock", "status"] as const) {
    if (data[key] !== undefined) patch[key] = data[key];
  }
  if (Object.keys(patch).length) {
    await db.update(items).set(patch as any).where(and(eq(items.id, id), eq(items.businessId, businessId)));
  } else {
    await db.update(items).set({ updatedAt: new Date() }).where(and(eq(items.id, id), eq(items.businessId, businessId)));
  }

  if (data.variants) {
    const existing = await db
      .select({ id: itemVariants.id })
      .from(itemVariants)
      .where(and(eq(itemVariants.itemId, id), isNull(itemVariants.deletedAt)));
    const keep = new Set(data.variants.map((v) => v.id).filter((x): x is string => Boolean(x)));
    const removed = existing.map((e) => e.id).filter((vid) => !keep.has(vid));
    if (removed.length) await db.update(itemVariants).set({ deletedAt: new Date() }).where(inArray(itemVariants.id, removed));
    for (const [position, v] of data.variants.entries()) {
      if (v.id) {
        await db
          .update(itemVariants)
          .set({ name: v.name, sku: v.sku, ...(v.barcode !== undefined ? { barcode: v.barcode } : {}), basePrice: v.basePrice, cost: v.cost, position })
          .where(and(eq(itemVariants.id, v.id), eq(itemVariants.itemId, id)));
        await writeVariantPrices(db, v.id, v.prices);
      } else {
        const variantId = newId();
        await db.insert(itemVariants).values({ id: variantId, businessId, itemId: id, name: v.name, sku: v.sku, barcode: v.barcode ?? null, basePrice: v.basePrice, cost: v.cost, position });
        await writeVariantPrices(db, variantId, v.prices);
      }
    }
  }
  if (data.modifierSetIds) await writeModifierSets(db, id, data.modifierSetIds);
  await writeOutlets(db, businessId, id, data, false);
};

export const softDeleteItem = async (db: Db, businessId: string, id: string): Promise<boolean> => {
  const [res] = await db
    .update(items)
    .set({ deletedAt: new Date() })
    .where(and(eq(items.id, id), eq(items.businessId, businessId), isNull(items.deletedAt)));
  if (res.affectedRows === 0) return false;
  await db.update(itemVariants).set({ deletedAt: new Date() }).where(and(eq(itemVariants.itemId, id), isNull(itemVariants.deletedAt)));
  return true;
};

/** Ringkasan untuk jejak audit; harga per sales type dipetakan agar mudah dibandingkan. */
export const snapshotItem = (item: FullItem) => ({
  name: item.name,
  status: item.status,
  trackStock: item.trackStock,
  categoryId: item.categoryId,
  brandId: item.brandId,
  variants: item.variants.map((v) => ({
    name: v.name,
    sku: v.sku,
    barcode: v.barcode,
    basePrice: v.basePrice,
    cost: v.cost,
    prices: Object.fromEntries(v.prices.map((p) => [p.salesTypeId, p.price]).sort()),
  })),
  modifierSetIds: [...item.modifierSetIds].sort(),
  outletIds: [...item.outletIds].sort(),
});

export const pricesChanged = (before: ReturnType<typeof snapshotItem>, after: ReturnType<typeof snapshotItem>): boolean =>
  JSON.stringify(before.variants.map((v) => [v.name, v.basePrice, v.cost, v.prices])) !==
  JSON.stringify(after.variants.map((v) => [v.name, v.basePrice, v.cost, v.prices]));

export { sql };
