import { describe, expect, it } from "vitest";
import { applyPromos, computeOrder, defaultOrderSettings, isPromoActive, localParts, type PromoDef, type PromoLine } from "../src/index";

const promo = (over: Partial<PromoDef> = {}): PromoDef => ({
  id: "p1",
  type: "item_discount",
  startsAt: null,
  endsAt: null,
  hours: null,
  weekdays: null,
  multiple: false,
  requirementScope: "item",
  requirementItemId: "kopi",
  requirementCategoryId: null,
  requirementQuantity: 1,
  rewardKind: "percent",
  rewardValue: 1000,
  rewardItemId: null,
  rewardQuantity: 1,
  salesTypeIds: [],
  ...over,
});

const line = (id: string, itemId: string, unitPrice: number, quantity: number, categoryId: string | null = null): PromoLine => ({ id, itemId, categoryId, unitPrice, quantity });

// Rabu 14 Okt 2026, 10:30 WIB (UTC+7) = 03:30 UTC
const ctx = { now: new Date("2026-10-14T03:30:00Z"), timezone: "Asia/Jakarta", salesTypeId: null as string | null };

describe("diskon per item", () => {
  it("persen: memotong unit yang memenuhi syarat", () => {
    const r = applyPromos([line("a", "kopi", 20_000, 2)], [promo({ rewardValue: 1000 })], ctx);
    expect(r.perLine).toEqual({ a: 4_000 }); // 10% x 2 unit x 20.000
  });

  it("syarat jumlah (beli minimal N): tidak berlaku bila kurang; bila cukup SEMUA unit didiskon", () => {
    const p = promo({ requirementQuantity: 3, rewardValue: 5000 });
    expect(applyPromos([line("a", "kopi", 10_000, 2)], [p], ctx).perLine).toEqual({});
    expect(applyPromos([line("a", "kopi", 10_000, 3)], [p], ctx).perLine).toEqual({ a: 15_000 });
    expect(applyPromos([line("a", "kopi", 10_000, 5)], [p], ctx).perLine).toEqual({ a: 25_000 }); // 5 unit x 50%
  });

  it("persen dengan kelipatan: hanya kelompok penuh (3 dari 5 unit)", () => {
    const p = promo({ requirementQuantity: 3, rewardValue: 5000, multiple: true });
    expect(applyPromos([line("a", "kopi", 10_000, 5)], [p], ctx).perLine).toEqual({ a: 15_000 });
  });

  it("persen satu unit syarat: setiap kopi didiskon", () => {
    expect(applyPromos([line("a", "kopi", 10_000, 3)], [promo({ requirementQuantity: 1, rewardValue: 1000 })], ctx).perLine).toEqual({ a: 3_000 });
  });

  it("kelipatan: berlaku untuk setiap kelompok syarat", () => {
    const p = promo({ requirementQuantity: 2, rewardValue: 5000, multiple: true });
    expect(applyPromos([line("a", "kopi", 10_000, 5)], [p], ctx).perLine).toEqual({ a: 20_000 }); // 4 unit dipotong 50%
  });

  it("nominal: potongan tetap per kelompok, tidak melebihi harga unit", () => {
    const p = promo({ rewardKind: "amount", rewardValue: 3_000, requirementQuantity: 1, multiple: true });
    expect(applyPromos([line("a", "kopi", 10_000, 2)], [p], ctx).perLine).toEqual({ a: 6_000 });
    const big = promo({ rewardKind: "amount", rewardValue: 50_000 });
    expect(applyPromos([line("a", "kopi", 10_000, 1)], [big], ctx).perLine).toEqual({ a: 10_000 });
  });

  it("syarat per kategori: item mana pun dari kategori itu", () => {
    const p = promo({ requirementScope: "category", requirementItemId: null, requirementCategoryId: "minuman", requirementQuantity: 2, rewardValue: 1000, multiple: true });
    const lines = [line("a", "teh", 8_000, 1, "minuman"), line("b", "kopi", 20_000, 1, "minuman"), line("c", "roti", 15_000, 1, "makanan")];
    const r = applyPromos(lines, [p], ctx);
    expect(r.perLine).toEqual({ a: 800, b: 2_000 });
  });

  it("item lain tidak terpengaruh", () => {
    expect(applyPromos([line("a", "teh", 8_000, 3)], [promo()], ctx).perLine).toEqual({});
  });
});

describe("beli X gratis Y", () => {
  const buyGet = (over: Partial<PromoDef> = {}) =>
    promo({ type: "free_item", rewardKind: "free_item", rewardItemId: "roti", rewardQuantity: 1, requirementQuantity: 2, ...over });

  it("item berbeda: beli 2 kopi, 1 roti gratis", () => {
    const r = applyPromos([line("a", "kopi", 20_000, 2), line("b", "roti", 15_000, 1)], [buyGet()], ctx);
    expect(r.perLine).toEqual({ b: 15_000 });
  });

  it("tidak berlaku bila syarat kurang atau item hadiah tidak ada di keranjang", () => {
    expect(applyPromos([line("a", "kopi", 20_000, 1), line("b", "roti", 15_000, 1)], [buyGet()], ctx).perLine).toEqual({});
    expect(applyPromos([line("a", "kopi", 20_000, 2)], [buyGet()], ctx).perLine).toEqual({});
  });

  it("unit hadiah termurah yang digratiskan", () => {
    const r = applyPromos([line("a", "kopi", 20_000, 2), line("big", "roti", 25_000, 1), line("small", "roti", 12_000, 1)], [buyGet()], ctx);
    expect(r.perLine).toEqual({ small: 12_000 });
  });

  it("item yang sama (beli 2 gratis 1): butuh 3 unit, 1 gratis", () => {
    const p = buyGet({ requirementItemId: "kopi", rewardItemId: "kopi" });
    expect(applyPromos([line("a", "kopi", 10_000, 2)], [p], ctx).perLine).toEqual({}); // 2 unit belum cukup
    expect(applyPromos([line("a", "kopi", 10_000, 3)], [p], ctx).perLine).toEqual({ a: 10_000 });
    expect(applyPromos([line("a", "kopi", 10_000, 5)], [p], ctx).perLine).toEqual({ a: 10_000 }); // tanpa kelipatan: sekali
  });

  it("item yang sama dengan kelipatan: 6 unit = 2 gratis; 8 unit = 2 gratis (kelipatan 3)", () => {
    const p = buyGet({ requirementItemId: "kopi", rewardItemId: "kopi", multiple: true });
    expect(applyPromos([line("a", "kopi", 10_000, 6)], [p], ctx).perLine).toEqual({ a: 20_000 });
    expect(applyPromos([line("a", "kopi", 10_000, 8)], [p], ctx).perLine).toEqual({ a: 20_000 });
  });

  it("jumlah hadiah lebih dari 1 dan dibatasi stok hadiah di keranjang", () => {
    const p = buyGet({ rewardQuantity: 2, multiple: true });
    const r = applyPromos([line("a", "kopi", 20_000, 4), line("b", "roti", 15_000, 3)], [p], ctx);
    // 2 kelompok x 2 hadiah = 4 unit gratis diminta, tetapi hanya ada 3 roti: ketiganya gratis.
    expect(r.perLine).toEqual({ b: 45_000 });
  });

  it("hadiah yang tersedia lebih sedikit dari yang diminta hanya menggratiskan yang ada", () => {
    const p = buyGet({ rewardQuantity: 2, multiple: true });
    expect(applyPromos([line("a", "kopi", 20_000, 2), line("b", "roti", 15_000, 1)], [p], ctx).perLine).toEqual({ b: 15_000 });
  });
});

describe("jadwal dan tipe penjualan", () => {
  it("rentang tanggal", () => {
    expect(isPromoActive(promo({ startsAt: new Date("2026-10-15T00:00:00Z") }), ctx)).toBe(false);
    expect(isPromoActive(promo({ endsAt: new Date("2026-10-13T00:00:00Z") }), ctx)).toBe(false);
    expect(isPromoActive(promo({ startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-31T00:00:00Z") }), ctx)).toBe(true);
  });

  it("hari dan jam dihitung di zona waktu outlet, bukan UTC", () => {
    // 03:30 UTC = 10:30 WIB (Rabu). Di UTC jam ini 03:30.
    expect(localParts(ctx.now, "Asia/Jakarta")).toEqual({ weekday: 3, minutes: 10 * 60 + 30 });
    expect(localParts(ctx.now, "UTC")).toEqual({ weekday: 3, minutes: 3 * 60 + 30 });
    const morning = promo({ hours: { from: "09:00", to: "12:00" } });
    expect(isPromoActive(morning, ctx)).toBe(true); // 10:30 WIB
    expect(isPromoActive(morning, { ...ctx, timezone: "UTC" })).toBe(false); // 03:30 UTC
  });

  it("hari bisa bergeser karena zona waktu (23:00 UTC Selasa = Rabu 06:00 WIB)", () => {
    const wed = promo({ weekdays: [3] });
    const lateTue = new Date("2026-10-13T23:00:00Z");
    expect(isPromoActive(wed, { ...ctx, now: lateTue })).toBe(true); // WIB sudah Rabu
    expect(isPromoActive(wed, { ...ctx, now: lateTue, timezone: "UTC" })).toBe(false);
  });

  it("jendela melewati tengah malam", () => {
    const night = promo({ hours: { from: "22:00", to: "02:00" } });
    expect(isPromoActive(night, { ...ctx, now: new Date("2026-10-14T16:00:00Z") })).toBe(true); // 23:00 WIB
    expect(isPromoActive(night, { ...ctx, now: new Date("2026-10-14T18:30:00Z") })).toBe(true); // 01:30 WIB
    expect(isPromoActive(night, ctx)).toBe(false); // 10:30 WIB
  });

  it("tipe penjualan: kosong = semua; terisi = hanya yang terdaftar", () => {
    expect(isPromoActive(promo({ salesTypeIds: [] }), ctx)).toBe(true);
    expect(isPromoActive(promo({ salesTypeIds: ["dine"] }), { ...ctx, salesTypeId: "dine" })).toBe(true);
    expect(isPromoActive(promo({ salesTypeIds: ["dine"] }), { ...ctx, salesTypeId: "take" })).toBe(false);
    expect(isPromoActive(promo({ salesTypeIds: ["dine"] }), ctx)).toBe(false);
  });

  it("promo tidak berlaku di luar jadwal sehingga tidak ada diskon", () => {
    const p = promo({ weekdays: [0] }); // hanya Minggu
    expect(applyPromos([line("a", "kopi", 20_000, 2)], [p], ctx).perLine).toEqual({});
  });
});

describe("satu unit, satu promo", () => {
  it("promo kedua tidak menimpa unit yang sudah mendapat promo pertama", () => {
    const first = promo({ id: "p1", rewardValue: 1000 });
    const second = promo({ id: "p2", rewardValue: 5000 });
    const r = applyPromos([line("a", "kopi", 10_000, 1)], [first, second], ctx);
    expect(r.applications).toEqual([{ promoId: "p1", lineId: "a", amount: 1_000 }]);
  });

  it("unit yang tersisa tetap bisa memperoleh promo berikutnya", () => {
    const first = promo({ id: "p1", requirementQuantity: 1, rewardValue: 1000 });
    const second = promo({ id: "p2", requirementItemId: "teh", rewardValue: 2000 });
    const r = applyPromos([line("a", "kopi", 10_000, 1), line("b", "teh", 10_000, 1)], [first, second], ctx);
    expect(r.perLine).toEqual({ a: 1_000, b: 2_000 });
  });
});

describe("terintegrasi dengan total pesanan", () => {
  it("diskon promo masuk ke total sebelum service charge dan pajak", () => {
    const lines = [line("a", "kopi", 20_000, 2), line("b", "roti", 15_000, 1)];
    const promos = [promo({ type: "free_item", rewardKind: "free_item", rewardItemId: "roti", requirementQuantity: 2 })];
    const { perLine } = applyPromos(lines, promos, ctx);
    const totals = computeOrder({
      lines: lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice, quantity: l.quantity, promoDiscount: perLine[l.id] ?? 0 })),
      taxRatesBp: [1000],
      gratuityRatesBp: [],
      settings: defaultOrderSettings,
    });
    expect(totals.subtotal).toBe(55_000);
    expect(totals.promoDiscountTotal).toBe(15_000);
    expect(totals.base).toBe(40_000);
    expect(totals.total).toBe(44_000); // 40.000 + pajak 10%
  });

  it("menolak baris tidak valid", () => {
    expect(() => applyPromos([line("a", "kopi", -1, 1)], [promo()], ctx)).toThrow(RangeError);
    expect(() => applyPromos([line("a", "kopi", 100, 0)], [promo()], ctx)).toThrow(RangeError);
  });
});
