import { computeOrder, type DiscountInput, type OrderSettings, type OrderTotals } from "./order";
import { applyPromos, type PromoDef } from "./promo";

/**
 * Harga keranjang dari data katalog yang sudah dimuat. Murni (tanpa DB/UI): server memakai `priceLines`,
 * kasir offline memakai `priceCartOffline`, sehingga angka keduanya identik (diuji paritas di apps/api/test/sync.test.ts).
 */

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

export interface Rates {
  taxes: { id: string; name: string; rateBp: number }[];
  gratuities: { id: string; name: string; rateBp: number }[];
}

/** Bagian konteks outlet yang dibutuhkan untuk menghitung harga. */
export interface PricingContext {
  timezone: string;
  settings: OrderSettings;
}

export interface PricedOrder {
  totals: OrderTotals;
  /** id baris (key) -> promo yang berlaku. */
  promoByLine: Record<string, string>;
  snapshot: Record<string, unknown>;
}

/** Promo otomatis lalu `computeOrder`. Murni terhadap masukan. */
export const priceLines = (
  lines: readonly ResolvedLine[],
  orderDiscount: StoredDiscount | null,
  ctx: PricingContext,
  rates: Rates,
  promoDefs: readonly PromoDef[],
  salesTypeId: string,
  now = new Date(),
): PricedOrder => {
  const promoLines = lines.flatMap((l) => (l.itemId ? [{ id: l.key, itemId: l.itemId, categoryId: l.categoryId, unitPrice: l.unitPrice, quantity: l.quantity }] : []));
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

// ---------------------------------------------------------------------------------------------
// Keranjang offline: hanya id katalog, jumlah, dan pilihan (sama dengan skema di apps/api/src/pos/pricing.ts).

export type DiscountPick = { discountId: string; value?: number | undefined };

export type CartLineInput =
  | { kind: "item"; variantId: string; quantity: number; modifierOptionIds: string[]; note?: string | null | undefined; discount?: DiscountPick | null | undefined }
  | { kind: "bundle"; bundleId: string; quantity: number; note?: string | null | undefined; discount?: DiscountPick | null | undefined };

export interface CartInput {
  salesTypeId: string;
  lines: CartLineInput[];
  orderDiscount?: DiscountPick | null | undefined;
  label?: string | null | undefined;
  note?: string | null | undefined;
}

/** Bentuk katalog yang dikirim `/pos/catalog` (dipakai juga sebagai cache offline). */
export interface OfflineCatalog {
  salesTypes: { id: string; name: string }[];
  discounts: { id: string; name: string; kind: "percent" | "amount"; value: number; scope: "order" | "item"; itemIds: string[]; categoryIds: string[]; customizable: boolean }[];
  items: {
    id: string;
    name: string;
    categoryId: string | null;
    variants: { id: string; name: string; sku: string | null; basePrice: number; prices: Record<string, number> }[];
    modifierSets: { id: string; name: string; minSelect: number; maxSelect: number | null; options: { id: string; name: string; price: number }[] }[];
  }[];
  bundles: { id: string; name: string; price: number; prices: Record<string, number> }[];
}

/** Promo untuk dikirim lewat JSON (tanggal sebagai teks ISO). */
export type PromoWire = Omit<PromoDef, "startsAt" | "endsAt"> & { startsAt: string | null; endsAt: string | null };

export const promoToWire = (p: PromoDef): PromoWire => ({ ...p, startsAt: p.startsAt ? p.startsAt.toISOString() : null, endsAt: p.endsAt ? p.endsAt.toISOString() : null });
export const promoFromWire = (p: PromoWire): PromoDef => ({ ...p, startsAt: p.startsAt ? new Date(p.startsAt) : null, endsAt: p.endsAt ? new Date(p.endsAt) : null });

/** Data harga outlet yang disimpan perangkat agar bisa menghitung total tanpa server. */
export interface PricingPack {
  outletId: string;
  timezone: string;
  settings: OrderSettings;
  taxes: Rates["taxes"];
  /** Gratuity yang berlaku per tipe penjualan (sudah disaring per outlet dan pengaturan checkout). */
  gratuitiesBySalesType: Record<string, Rates["gratuities"]>;
  promos: PromoWire[];
  serverTime: string;
}

/** Galat keranjang offline; `field` dan `key` sama dengan galat validasi server. */
export class CartError extends Error {
  constructor(
    public readonly field: string,
    public readonly key: string = "errors.notFound",
  ) {
    super(`${field}: ${key}`);
  }
}

const fail = (field: string, key = "errors.notFound"): never => {
  throw new CartError(field, key);
};

type DiscountUse = { kind: "order" } | { kind: "line"; itemId: string | null; categoryId: string | null };

const resolveDiscount = (pick: DiscountPick | null | undefined, available: Map<string, OfflineCatalog["discounts"][number]>, canDiscount: boolean, field: string, use: DiscountUse): StoredDiscount | null => {
  if (!pick) return null;
  if (!canDiscount) return fail(field, "forbidden");
  const d = available.get(pick.discountId);
  if (!d) return fail(field);
  if (use.kind === "order" ? d.scope !== "order" : d.scope !== "item" || !((use.itemId && d.itemIds.includes(use.itemId)) || (use.categoryId && d.categoryIds.includes(use.categoryId)))) {
    return fail(field, "pos.discountScope");
  }
  const value = pick.value !== undefined && d.customizable ? pick.value : d.value;
  if (pick.value !== undefined && !d.customizable && pick.value !== d.value) return fail(field, "pos.discountFixed");
  if (d.kind === "percent" && value > 10_000) return fail(field, "pos.discountRange");
  return { kind: d.kind, value, discountId: d.id };
};

/** Menyelesaikan keranjang terhadap katalog yang sudah dimuat (padanan `resolveCart` di server, tanpa biaya pokok). */
export const resolveCartOffline = (catalog: OfflineCatalog, cart: CartInput, canDiscount: boolean): { lines: ResolvedLine[]; orderDiscount: StoredDiscount | null } => {
  if (!catalog.salesTypes.some((s) => s.id === cart.salesTypeId)) fail("salesTypeId");
  const discounts = new Map(catalog.discounts.map((d) => [d.id, d]));
  const orderDiscount = resolveDiscount(cart.orderDiscount, discounts, canDiscount, "orderDiscount", { kind: "order" });

  const variantIndex = new Map<string, { item: OfflineCatalog["items"][number]; variant: OfflineCatalog["items"][number]["variants"][number] }>();
  for (const item of catalog.items) for (const variant of item.variants) variantIndex.set(variant.id, { item, variant });
  const bundleIndex = new Map(catalog.bundles.map((b) => [b.id, b]));

  const lines = cart.lines.map((l, i): ResolvedLine => {
    if (l.kind === "bundle") {
      const b = bundleIndex.get(l.bundleId);
      if (!b) return fail(`lines.${i}.bundleId`);
      const price = b.prices[cart.salesTypeId] ?? b.price;
      return {
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
        discount: resolveDiscount(l.discount, discounts, canDiscount, `lines.${i}.discount`, { kind: "line", itemId: null, categoryId: null }),
        note: l.note ?? null,
        modifiers: [],
      };
    }
    const found = variantIndex.get(l.variantId);
    if (!found) return fail(`lines.${i}.variantId`);
    const { item, variant } = found;
    const optionById = new Map(item.modifierSets.flatMap((s) => s.options.map((o) => [o.id, { ...o, setId: s.id }] as const)));
    const chosen = [...new Set(l.modifierOptionIds)];
    const picked = chosen.map((id) => optionById.get(id) ?? fail(`lines.${i}.modifierOptionIds`));
    for (const set of item.modifierSets) {
      const count = picked.filter((o) => o.setId === set.id).length;
      if (count < set.minSelect || (set.maxSelect !== null && count > set.maxSelect)) fail(`lines.${i}.modifierOptionIds`, "pos.modifierLimit");
    }
    const base = variant.prices[cart.salesTypeId] ?? variant.basePrice;
    return {
      key: String(i),
      itemId: item.id,
      variantId: variant.id,
      bundleId: null,
      categoryId: item.categoryId,
      name: item.variants.length > 1 ? `${item.name} (${variant.name})` : item.name,
      sku: variant.sku,
      unitPrice: base + picked.reduce((a, o) => a + o.price, 0),
      basePrice: base,
      cost: 0,
      quantity: l.quantity,
      discount: resolveDiscount(l.discount, discounts, canDiscount, `lines.${i}.discount`, { kind: "line", itemId: item.id, categoryId: item.categoryId }),
      note: l.note ?? null,
      modifiers: picked.map((o) => ({ optionId: o.id, name: o.name, price: o.price })),
    };
  });
  return { lines, orderDiscount };
};

export interface OfflinePrice {
  lines: ResolvedLine[];
  orderDiscount: StoredDiscount | null;
  priced: PricedOrder;
  rates: Rates;
}

/** Menghitung keranjang tanpa server. Tidak mendukung pelanggan/reward (butuh server). */
export const priceCartOffline = (pack: PricingPack, catalog: OfflineCatalog, cart: CartInput, canDiscount: boolean, now = new Date()): OfflinePrice => {
  const { lines, orderDiscount } = resolveCartOffline(catalog, cart, canDiscount);
  const rates: Rates = { taxes: pack.taxes, gratuities: pack.gratuitiesBySalesType[cart.salesTypeId] ?? [] };
  const priced = priceLines(lines, orderDiscount, pack, rates, pack.promos.map(promoFromWire), cart.salesTypeId, now);
  return { lines, orderDiscount, priced, rates };
};
