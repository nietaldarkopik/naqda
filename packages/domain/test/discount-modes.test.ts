import { describe, expect, it } from "vitest";
import { allocateProportional, computeOrder, defaultOrderSettings, discountModes, type DiscountMode, type OrderInput } from "../src/index";

const run = (mode: DiscountMode, over: Partial<OrderInput> = {}) =>
  computeOrder({
    lines: [
      { id: "A", unitPrice: 100_000, quantity: 1, discount: { kind: "percent", bp: 1000 }, promoDiscount: 5_000 },
      { id: "B", unitPrice: 50_000, quantity: 1 },
    ],
    orderDiscount: { kind: "percent", bp: 1000 },
    taxRatesBp: [],
    gratuityRatesBp: [],
    settings: { ...defaultOrderSettings, discountMode: mode },
    ...over,
  });

describe("mode gabung diskon", () => {
  it("berurutan: diskon baris, promo, lalu diskon pesanan dari sisa harga", () => {
    const r = run("sequential");
    // A: 100.000 - 10.000 - 5.000 = 85.000; B 50.000; sisa 135.000; diskon pesanan 10% = 13.500
    expect(r).toMatchObject({ lineDiscountTotal: 10_000, promoDiscountTotal: 5_000, orderDiscount: 13_500, base: 121_500, total: 121_500 });
    expect(r.lines.map((l) => l.orderDiscountShare)).toEqual([8_500, 5_000]);
  });

  it("kombinasi: diskon persen pesanan dihitung dari harga awal lalu dijumlahkan", () => {
    const r = run("stack");
    // 10% x 150.000 = 15.000 (bukan 13.500)
    expect(r).toMatchObject({ lineDiscountTotal: 10_000, promoDiscountTotal: 5_000, orderDiscount: 15_000, base: 120_000 });
    expect(r.lines.reduce((a, l) => a + l.orderDiscountShare, 0)).toBe(15_000);
  });

  it("salah satu: satu baris satu diskon (terbesar), diskon pesanan hanya untuk baris tanpa diskon", () => {
    const r = run("exclusive");
    // A memilih diskon baris 10.000 (promo 5.000 dibuang); B belum berdiskon -> diskon pesanan 10% x 50.000 = 5.000
    expect(r.lines[0]).toMatchObject({ discount: 10_000, promoDiscount: 0, orderDiscountShare: 0, afterDiscount: 90_000 });
    expect(r.lines[1]).toMatchObject({ discount: 0, orderDiscountShare: 5_000 });
    expect(r).toMatchObject({ orderDiscount: 5_000, discountTotal: 15_000, base: 135_000 });
  });

  it("salah satu: bila promo lebih besar dari diskon baris, promo yang dipakai", () => {
    const r = computeOrder({
      lines: [{ id: "A", unitPrice: 100_000, quantity: 1, discount: { kind: "percent", bp: 500 }, promoDiscount: 20_000 }],
      taxRatesBp: [],
      gratuityRatesBp: [],
      settings: { ...defaultOrderSettings, discountMode: "exclusive" },
    });
    expect(r.lines[0]).toMatchObject({ discount: 0, promoDiscount: 20_000, afterDiscount: 80_000 });
  });

  it("salah satu: semua baris sudah berdiskon -> diskon pesanan 0", () => {
    const r = computeOrder({
      lines: [{ id: "A", unitPrice: 100_000, quantity: 1, discount: { kind: "percent", bp: 500 } }],
      orderDiscount: { kind: "amount", amount: 50_000 },
      taxRatesBp: [],
      gratuityRatesBp: [],
      settings: { ...defaultOrderSettings, discountMode: "exclusive" },
    });
    expect(r.orderDiscount).toBe(0);
    expect(r.base).toBe(95_000);
  });

  it("tanpa discountMode memakai berurutan (perilaku lama)", () => {
    const { discountMode: _omit, ...rest } = defaultOrderSettings;
    const withoutMode = run("sequential", { settings: rest });
    expect(withoutMode).toEqual(run("sequential"));
  });

  it("sapuan: di semua mode diskon tidak melebihi harga, pembagian ke baris tepat, total tidak negatif", () => {
    const prices = [0, 1, 999, 10_000, 33_333];
    const orderDiscounts = [null, { kind: "percent" as const, bp: 3333 }, { kind: "percent" as const, bp: 10_000 }, { kind: "amount" as const, amount: 40_000 }];
    const lineDiscounts = [null, { kind: "percent" as const, bp: 2500 }, { kind: "amount" as const, amount: 700 }];
    const promos = [0, 400, 50_000];
    let combos = 0;
    for (const mode of discountModes)
      for (const p1 of prices)
        for (const p2 of prices)
          for (const od of orderDiscounts)
            for (const ld of lineDiscounts)
              for (const pr of promos) {
                const r = computeOrder({
                  lines: [
                    { id: "A", unitPrice: p1, quantity: 2, discount: ld, promoDiscount: pr },
                    { id: "B", unitPrice: p2, quantity: 3 },
                  ],
                  orderDiscount: od,
                  taxRatesBp: [1100],
                  gratuityRatesBp: [500],
                  settings: { ...defaultOrderSettings, discountMode: mode },
                });
                combos++;
                expect(r.base).toBeGreaterThanOrEqual(0);
                expect(r.base).toBe(r.subtotal - r.discountTotal);
                expect(r.lines.reduce((a, l) => a + l.orderDiscountShare, 0)).toBe(r.orderDiscount);
                for (const l of r.lines) expect(l.orderDiscountShare).toBeLessThanOrEqual(l.afterDiscount);
                expect(r.total).toBeGreaterThanOrEqual(0);
              }
    expect(combos).toBeGreaterThan(1500);
  });
});

describe("allocateProportional", () => {
  it("jumlah tepat, sisa ke pecahan terbesar, bobot nol tidak menerima", () => {
    expect(allocateProportional(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportional(100, [0, 50, 50])).toEqual([0, 50, 50]);
    expect(allocateProportional(5, [0, 0])).toEqual([0, 0]);
    expect(allocateProportional(7, [3, 0, 4]).reduce((a, b) => a + b, 0)).toBe(7);
  });
});
