import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  bundleOutlets,
  bundlePrices,
  bundles,
  discountCategories,
  discountItems,
  discountOutlets,
  discounts,
  gratuities,
  gratuityOutlets,
  itemModifierSets,
  itemOutlets,
  itemVariantPrices,
  itemVariants,
  items,
  modifierOptions,
  modifierSets,
  outlets,
  promoOutlets,
  promoSalesTypes,
  promos,
  salesTypeGratuities,
  salesTypes,
  taxOutlets,
  taxes,
  type DbHandle,
} from "@naqdi/db";
import {
  applyPromos,
  computeOrder,
  type DiscountInput,
  type OrderSettings,
  type OrderTotals,
  type PromoDef,
} from "@naqdi/domain";
import { AppError } from "../errors";

type Db = DbHandle["db"];

export interface StoredDiscount {
  kind: "percent" | "amount";
  value: number;
  discountId?: string | null;
}

export const toDiscountInput = (d: StoredDiscount | null | undefined): DiscountInput | null =>
  !d ? null : d.kind === "percent" ? { kind: "percent", bp: d.value } : { kind: "amount", amount: d.value };

export const fromDiscountInput = (d: DiscountInput | null | undefined, discountId?: string | null): StoredDiscount | null =>
  !d ? null : d.kind === "percent" ? { kind: "percent", value: d.bp, discountId: discountId ?? null } : { kind: "amount", value: d.amount, discountId: discountId ?? null };

/** Baris pesanan yang sudah diselesaikan terhadap katalog; harga di sini adalah SALINAN yang akan dibekukan di order_items. */
export interface ResolvedLine {
  key: string;
  itemId: string | null;
  variantId: string | null;
  bundleId: string | null;
  categoryId: string | null;
  name: string;
  sku: string | null;
  /** Harga satuan termasuk modifier. */
  unitPrice: number;
  basePrice: number;
  cost: number;
  quantity: number;
  discount: StoredDiscount | null;
  note: string | null;
  modifiers: { optionId: string | null; name: string; price: number }[];
}

export interface OutletContext {
  outletId: string;
  businessId: string;
  timezone: string;
  settings: OrderSettings;
}

/** Diskon yang boleh dipilih kasir di outlet ini. */
export const outletDiscounts = async (db: Db, ctx: OutletContext) => {
  const rows = await db
    .select({ d: discounts })
    .from(discounts)
    .innerJoin(discountOutlets, eq(discountOutlets.discountId, discounts.id))
    .where(and(eq(discounts.businessId, ctx.businessId), eq(discountOutlets.outletId, ctx.outletId), isNull(discounts.deletedAt), eq(discounts.status, "active")))
    .orderBy(asc(discounts.name));
  const ids = rows.map((r) => r.d.id);
  const itemLinks = ids.length ? await db.select().from(discountItems).where(inArray(discountItems.discountId, ids)) : [];
  const catLinks = ids.length ? await db.select().from(discountCategories).where(inArray(discountCategories.discountId, ids)) : [];
  return rows.map((r) => ({
    ...r.d,
    itemIds: itemLinks.filter((l) => l.discountId === r.d.id).map((l) => l.itemId),
    categoryIds: catLinks.filter((l) => l.discountId === r.d.id).map((l) => l.categoryId),
  }));
};

export type OutletDiscount = Awaited<ReturnType<typeof outletDiscounts>>[number];

export const loadOutletContext = async (db: Db, businessId: string, outletId: string): Promise<OutletContext> => {
  const [o] = await db.select().from(outlets).where(and(eq(outlets.id, outletId), eq(outlets.businessId, businessId))).limit(1);
  if (!o || o.deletedAt) throw new AppError("not_found");
  return {
    outletId,
    businessId,
    timezone: o.timezone,
    settings: {
      pricesIncludeTax: o.pricesIncludeTax,
      pricesIncludeGratuity: o.pricesIncludeGratuity,
      taxOnGratuity: o.taxOnGratuity,
      roundingStep: o.roundingStep,
      roundingMode: o.roundingMode,
      discountMode: o.discountMode,
    },
  };
};

export const loadSalesType = async (db: Db, businessId: string, salesTypeId: string) => {
  const [st] = await db
    .select()
    .from(salesTypes)
    .where(and(eq(salesTypes.id, salesTypeId), eq(salesTypes.businessId, businessId), isNull(salesTypes.deletedAt), eq(salesTypes.status, "active")))
    .limit(1);
  if (!st) throw new AppError("validation", { fields: { salesTypeId: "errors.notFound" } });
  return st;
};

export interface Rates {
  taxes: { id: string; name: string; rateBp: number }[];
  gratuities: { id: string; name: string; rateBp: number }[];
}

/** Pajak yang ditugaskan ke outlet; gratuity yang ditugaskan ke outlet DAN tertaut ke tipe penjualan pesanan. */
export const loadRates = async (db: Db, ctx: OutletContext, salesTypeId: string): Promise<Rates> => {
  const t = await db
    .select({ id: taxes.id, name: taxes.name, rateBp: taxes.rateBp })
    .from(taxes)
    .innerJoin(taxOutlets, eq(taxOutlets.taxId, taxes.id))
    .where(and(eq(taxes.businessId, ctx.businessId), eq(taxOutlets.outletId, ctx.outletId), isNull(taxes.deletedAt)))
    .orderBy(asc(taxes.name));
  const g = await db
    .select({ id: gratuities.id, name: gratuities.name, rateBp: gratuities.rateBp })
    .from(gratuities)
    .innerJoin(gratuityOutlets, eq(gratuityOutlets.gratuityId, gratuities.id))
    .innerJoin(salesTypeGratuities, and(eq(salesTypeGratuities.gratuityId, gratuities.id), eq(salesTypeGratuities.salesTypeId, salesTypeId)))
    .where(and(eq(gratuities.businessId, ctx.businessId), eq(gratuityOutlets.outletId, ctx.outletId), isNull(gratuities.deletedAt)))
    .orderBy(asc(gratuities.name));
  return { taxes: t, gratuities: g };
};

export const loadPromos = async (db: Db, ctx: OutletContext): Promise<PromoDef[]> => {
  const rows = await db
    .select({ p: promos })
    .from(promos)
    .innerJoin(promoOutlets, eq(promoOutlets.promoId, promos.id))
    .where(and(eq(promos.businessId, ctx.businessId), eq(promoOutlets.outletId, ctx.outletId), isNull(promos.deletedAt), eq(promos.status, "active")))
    .orderBy(asc(promos.createdAt), asc(promos.id));
  if (rows.length === 0) return [];
  const st = await db
    .select()
    .from(promoSalesTypes)
    .where(inArray(promoSalesTypes.promoId, rows.map((r) => r.p.id)));
  return rows.map(({ p }) => ({
    id: p.id,
    type: p.type,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    hours: p.hours,
    weekdays: p.weekdays,
    multiple: p.multiple,
    requirementScope: p.requirementScope,
    requirementItemId: p.requirementItemId,
    requirementCategoryId: p.requirementCategoryId,
    requirementQuantity: p.requirementQuantity,
    rewardKind: p.rewardKind,
    rewardValue: p.rewardValue,
    rewardItemId: p.rewardItemId,
    rewardQuantity: p.rewardQuantity,
    salesTypeIds: st.filter((s) => s.promoId === p.id).map((s) => s.salesTypeId),
  }));
};

// ---------------------------------------------------------------------------------------------
// Masukan dari kasir: HANYA id katalog, jumlah, dan pilihan. Harga tidak pernah diterima dari klien.

const discountPick = z.object({ discountId: z.string().uuid(), value: z.number().int().min(0).optional() });

export const cartLineSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item"),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(9999),
    modifierOptionIds: z.array(z.string().uuid()).max(50).default([]),
    note: z.string().trim().max(255).nullish(),
    discount: discountPick.nullish(),
  }),
  z.object({
    kind: z.literal("bundle"),
    bundleId: z.string().uuid(),
    quantity: z.number().int().min(1).max(9999),
    note: z.string().trim().max(255).nullish(),
    discount: discountPick.nullish(),
  }),
]);

export const cartSchema = z.object({
  salesTypeId: z.string().uuid(),
  lines: z.array(cartLineSchema).max(200),
  orderDiscount: discountPick.nullish(),
  label: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(500).nullish(),
  pax: z.number().int().min(1).max(999).nullish(),
});
export type Cart = z.infer<typeof cartSchema>;

const fail = (field: string, key = "errors.notFound"): never => {
  throw new AppError("validation", { fields: { [field]: key } });
};

/**
 * Memilih diskon dari daftar diskon outlet. Nilai bebas hanya untuk diskon `customizable`;
 * diskon persen dibatasi 100%. Wajib punya hak pos.discount.
 */
type DiscountUse = { kind: "order" } | { kind: "line"; itemId: string | null; categoryId: string | null };

const resolveDiscount = (
  pick: { discountId: string; value?: number | undefined } | null | undefined,
  available: Map<string, OutletDiscount>,
  canDiscount: boolean,
  field: string,
  use: DiscountUse,
): StoredDiscount | null => {
  if (!pick) return null;
  if (!canDiscount) throw new AppError("forbidden");
  const d = available.get(pick.discountId);
  if (!d) return fail(field);
  // Diskon umum hanya untuk pesanan; diskon item hanya untuk item/kategori sasarannya.
  if (use.kind === "order" ? d.scope !== "order" : d.scope !== "item" || !((use.itemId && d.itemIds.includes(use.itemId)) || (use.categoryId && d.categoryIds.includes(use.categoryId)))) {
    return fail(field, "pos.discountScope");
  }
  const value = pick.value !== undefined && d.customizable ? pick.value : d.value;
  if (pick.value !== undefined && !d.customizable && pick.value !== d.value) return fail(field, "pos.discountFixed");
  if (d.kind === "percent" && value > 10_000) return fail(field, "pos.discountRange");
  return { kind: d.kind, value, discountId: d.id };
};

/** Menyelesaikan keranjang terhadap katalog: harga, modifier, ketersediaan di outlet, dan diskon. */
export const resolveCart = async (
  db: Db,
  ctx: OutletContext,
  cart: Cart,
  canDiscount: boolean,
): Promise<{ lines: ResolvedLine[]; orderDiscount: StoredDiscount | null }> => {
  const availableDiscounts = new Map((await outletDiscounts(db, ctx)).map((d) => [d.id, d]));
  const orderDiscount = resolveDiscount(cart.orderDiscount, availableDiscounts, canDiscount, "orderDiscount", { kind: "order" });

  const itemLines = cart.lines.flatMap((l, i) => (l.kind === "item" ? [{ l, i }] : []));
  const bundleLines = cart.lines.flatMap((l, i) => (l.kind === "bundle" ? [{ l, i }] : []));
  const out: ResolvedLine[] = new Array(cart.lines.length);

  if (itemLines.length) {
    const variantIds = [...new Set(itemLines.map((x) => x.l.variantId))];
    const vrows = await db
      .select({ v: itemVariants, item: items, available: itemOutlets.available })
      .from(itemVariants)
      .innerJoin(items, eq(itemVariants.itemId, items.id))
      .innerJoin(itemOutlets, and(eq(itemOutlets.itemId, items.id), eq(itemOutlets.outletId, ctx.outletId)))
      .where(
        and(
          inArray(itemVariants.id, variantIds),
          eq(itemVariants.businessId, ctx.businessId),
          isNull(itemVariants.deletedAt),
          isNull(items.deletedAt),
          eq(items.status, "active"),
        ),
      );
    const variants = new Map(vrows.filter((r) => r.available).map((r) => [r.v.id, r]));
    const itemIds = [...new Set([...variants.values()].map((r) => r.item.id))];

    const siblings = itemIds.length
      ? await db.select({ itemId: itemVariants.itemId }).from(itemVariants).where(and(inArray(itemVariants.itemId, itemIds), isNull(itemVariants.deletedAt)))
      : [];
    const variantCount = new Map<string, number>();
    for (const s of siblings) variantCount.set(s.itemId, (variantCount.get(s.itemId) ?? 0) + 1);

    const prices = variantIds.length
      ? await db
          .select()
          .from(itemVariantPrices)
          .where(and(inArray(itemVariantPrices.variantId, variantIds), eq(itemVariantPrices.salesTypeId, cart.salesTypeId)))
      : [];
    const priceFor = new Map(prices.map((p) => [p.variantId, p.price]));

    const setLinks = itemIds.length ? await db.select().from(itemModifierSets).where(inArray(itemModifierSets.itemId, itemIds)) : [];
    const setIds = [...new Set(setLinks.map((s) => s.setId))];
    const sets = setIds.length ? await db.select().from(modifierSets).where(and(inArray(modifierSets.id, setIds), isNull(modifierSets.deletedAt))) : [];
    const options = setIds.length
      ? await db.select().from(modifierOptions).where(and(inArray(modifierOptions.setId, setIds), isNull(modifierOptions.deletedAt)))
      : [];
    const optionById = new Map(options.map((o) => [o.id, o]));

    for (const { l, i } of itemLines) {
      const row = variants.get(l.variantId);
      if (!row) return fail(`lines.${i}.variantId`);
      const allowedSets = new Set(setLinks.filter((s) => s.itemId === row.item.id).map((s) => s.setId));
      const chosen = [...new Set(l.modifierOptionIds)];
      const picked = chosen.map((id) => {
        const o = optionById.get(id);
        if (!o || !allowedSets.has(o.setId)) return fail(`lines.${i}.modifierOptionIds`);
        return o;
      });
      // Batas pilihan per set modifier.
      for (const setId of allowedSets) {
        const set = sets.find((s) => s.id === setId);
        if (!set) continue;
        const count = picked.filter((o) => o.setId === setId).length;
        if (count < set.minSelect || (set.maxSelect !== null && count > set.maxSelect)) fail(`lines.${i}.modifierOptionIds`, "pos.modifierLimit");
      }
      const base = priceFor.get(row.v.id) ?? row.v.basePrice;
      const modTotal = picked.reduce((a, o) => a + o.price, 0);
      out[i] = {
        key: String(i),
        itemId: row.item.id,
        variantId: row.v.id,
        bundleId: null,
        categoryId: row.item.categoryId,
        name: (variantCount.get(row.item.id) ?? 1) > 1 ? `${row.item.name} (${row.v.name})` : row.item.name,
        sku: row.v.sku,
        unitPrice: base + modTotal,
        basePrice: base,
        cost: row.v.cost,
        quantity: l.quantity,
        discount: resolveDiscount(l.discount, availableDiscounts, canDiscount, `lines.${i}.discount`, { kind: "line", itemId: row.item.id, categoryId: row.item.categoryId }),
        note: l.note ?? null,
        modifiers: picked.map((o) => ({ optionId: o.id, name: o.name, price: o.price })),
      };
    }
  }

  if (bundleLines.length) {
    const ids = [...new Set(bundleLines.map((x) => x.l.bundleId))];
    const brows = await db
      .select({ b: bundles })
      .from(bundles)
      .innerJoin(bundleOutlets, and(eq(bundleOutlets.bundleId, bundles.id), eq(bundleOutlets.outletId, ctx.outletId)))
      .where(and(inArray(bundles.id, ids), eq(bundles.businessId, ctx.businessId), isNull(bundles.deletedAt), eq(bundles.status, "active")));
    const byId = new Map(brows.map((r) => [r.b.id, r.b]));
    const bp = ids.length ? await db.select().from(bundlePrices).where(and(inArray(bundlePrices.bundleId, ids), eq(bundlePrices.salesTypeId, cart.salesTypeId))) : [];
    const bpMap = new Map(bp.map((p) => [p.bundleId, p.price]));
    for (const { l, i } of bundleLines) {
      const b = byId.get(l.bundleId);
      if (!b) return fail(`lines.${i}.bundleId`);
      const price = bpMap.get(b.id) ?? b.price;
      out[i] = {
        key: String(i),
        itemId: null,
        variantId: null,
        bundleId: b.id,
        categoryId: null,
        name: b.name,
        sku: null,
        unitPrice: price,
        basePrice: price,
        cost: 0,
        quantity: l.quantity,
        discount: resolveDiscount(l.discount, availableDiscounts, canDiscount, `lines.${i}.discount`, { kind: "line", itemId: null, categoryId: null }),
        note: l.note ?? null,
        modifiers: [],
      };
    }
  }

  return { lines: out, orderDiscount };
};

export interface PricedOrder {
  totals: OrderTotals;
  /** id baris (key) -> promo yang berlaku. */
  promoByLine: Record<string, string>;
  snapshot: Record<string, unknown>;
}

/** Promo otomatis lalu `computeOrder`. Murni terhadap masukan; tidak menyentuh DB selain data yang sudah dimuat. */
export const priceLines = (
  lines: readonly ResolvedLine[],
  orderDiscount: StoredDiscount | null,
  ctx: OutletContext,
  rates: Rates,
  promoDefs: readonly PromoDef[],
  salesTypeId: string,
  now = new Date(),
): PricedOrder => {
  const promoLines = lines.flatMap((l) =>
    l.itemId ? [{ id: l.key, itemId: l.itemId, categoryId: l.categoryId, unitPrice: l.unitPrice, quantity: l.quantity }] : [],
  );
  const promo = applyPromos(promoLines, promoDefs, { now, timezone: ctx.timezone, salesTypeId });
  const totals = computeOrder({
    lines: lines.map((l) => ({
      id: l.key,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      discount: toDiscountInput(l.discount),
      promoDiscount: promo.perLine[l.key] ?? 0,
    })),
    orderDiscount: toDiscountInput(orderDiscount),
    taxRatesBp: rates.taxes.map((t) => t.rateBp),
    gratuityRatesBp: rates.gratuities.map((g) => g.rateBp),
    settings: ctx.settings,
  });
  const promoByLine: Record<string, string> = {};
  for (const a of promo.applications) promoByLine[a.lineId] ??= a.promoId;
  return {
    totals,
    promoByLine,
    snapshot: {
      settings: ctx.settings,
      taxes: rates.taxes.map((t, i) => ({ ...t, amount: totals.taxPerRate[i] ?? 0 })),
      gratuities: rates.gratuities.map((g, i) => ({ ...g, amount: totals.gratuityPerRate[i] ?? 0 })),
      promos: promo.applications,
      computedAt: now.toISOString(),
    },
  };
};
