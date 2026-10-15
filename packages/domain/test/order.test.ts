import { describe, expect, it } from "vitest";
import { computeOrder, defaultOrderSettings, discountAmount, type OrderSettings } from "../src/index";

const settings = (over: Partial<OrderSettings> = {}): OrderSettings => ({ ...defaultOrderSettings, ...over });
const one = (price: number, qty = 1) => [{ id: "a", unitPrice: price, quantity: qty }];

describe("total pesanan: contoh hitungan tangan", () => {
  it("A. eksklusif: pajak 10% ditambahkan di atas harga", () => {
    const r = computeOrder({ lines: one(100_000), taxRatesBp: [1000], gratuityRatesBp: [], settings: settings() });
    expect(r).toMatchObject({ subtotal: 100_000, base: 100_000, net: 100_000, gratuity: 0, tax: 10_000, addedOnTop: 10_000, rounding: 0, total: 110_000 });
  });

  it("B. service 5% + pajak 10% atas harga dan atas service (bawaan)", () => {
    const r = computeOrder({ lines: one(100_000), taxRatesBp: [1000], gratuityRatesBp: [500], settings: settings() });
    expect(r).toMatchObject({ net: 100_000, gratuity: 5_000, taxOnGoods: 10_000, taxOnGratuity: 500, tax: 10_500, addedOnTop: 15_500, total: 115_500 });
  });

  it("C. pajak tidak dikenakan atas service charge", () => {
    const r = computeOrder({ lines: one(100_000), taxRatesBp: [1000], gratuityRatesBp: [500], settings: settings({ taxOnGratuity: false }) });
    expect(r).toMatchObject({ gratuity: 5_000, taxOnGratuity: 0, tax: 10_000, total: 115_000 });
  });

  it("D. harga sudah termasuk pajak, service di atas: menu 110.000", () => {
    const r = computeOrder({ lines: one(110_000), taxRatesBp: [1000], gratuityRatesBp: [500], settings: settings({ pricesIncludeTax: true }) });
    expect(r).toMatchObject({ net: 100_000, gratuity: 5_000, taxOnGoods: 10_000, taxOnGratuity: 500, addedOnTop: 5_500, total: 115_500 });
  });

  it("E. harga sudah termasuk pajak dan service: pelanggan membayar tepat harga menu", () => {
    const r = computeOrder({ lines: one(115_500), taxRatesBp: [1000], gratuityRatesBp: [500], settings: settings({ pricesIncludeTax: true, pricesIncludeGratuity: true }) });
    expect(r).toMatchObject({ net: 100_000, gratuity: 5_000, taxOnGoods: 10_000, taxOnGratuity: 500, addedOnTop: 0, total: 115_500 });
  });

  it("F. hanya service yang termasuk di harga, pajak di atas", () => {
    const r = computeOrder({ lines: one(105_000), taxRatesBp: [1000], gratuityRatesBp: [500], settings: settings({ pricesIncludeGratuity: true }) });
    expect(r).toMatchObject({ net: 100_000, gratuity: 5_000, taxOnGoods: 10_000, taxOnGratuity: 500, addedOnTop: 10_500, total: 115_500 });
  });

  it("G. tanpa pajak dan service: total = harga setelah diskon", () => {
    const r = computeOrder({ lines: one(50_000, 3), taxRatesBp: [], gratuityRatesBp: [], settings: settings() });
    expect(r).toMatchObject({ subtotal: 150_000, total: 150_000, tax: 0, gratuity: 0, taxPerRate: [], gratuityPerRate: [] });
  });

  it("H. beberapa tarif dialokasikan, jumlahnya tepat", () => {
    const r = computeOrder({ lines: one(100_000), taxRatesBp: [1000, 500], gratuityRatesBp: [300, 200], settings: settings({ taxOnGratuity: false }) });
    expect(r.gratuityPerRate).toEqual([3_000, 2_000]);
    expect(r.taxPerRate).toEqual([10_000, 5_000]);
    expect(r.total).toBe(100_000 + 5_000 + 15_000);
  });
});

describe("diskon", () => {
  const lines = [
    { id: "a", unitPrice: 50_000, quantity: 2, discount: { kind: "percent", bp: 1000 } as const },
    { id: "b", unitPrice: 30_000, quantity: 1, promoDiscount: 5_000 },
  ];

  it("urutan: diskon baris, promo, lalu diskon pesanan, sebelum pajak", () => {
    const r = computeOrder({ lines, orderDiscount: { kind: "amount", amount: 7_000 }, taxRatesBp: [1000], gratuityRatesBp: [], settings: settings() });
    expect(r.subtotal).toBe(130_000);
    expect(r.lineDiscountTotal).toBe(10_000);
    expect(r.promoDiscountTotal).toBe(5_000);
    expect(r.orderDiscount).toBe(7_000);
    expect(r.discountTotal).toBe(22_000);
    expect(r.base).toBe(108_000);
    expect(r.tax).toBe(10_800);
    expect(r.total).toBe(118_800);
    expect(r.lines.map((l) => l.afterDiscount)).toEqual([90_000, 25_000]);
  });

  it("diskon pesanan persen dihitung dari harga setelah diskon baris dan promo", () => {
    const r = computeOrder({ lines, orderDiscount: { kind: "percent", bp: 1000 }, taxRatesBp: [], gratuityRatesBp: [], settings: settings() });
    expect(r.orderDiscount).toBe(11_500); // 10% dari 115.000
    expect(r.total).toBe(103_500);
  });

  it("diskon tidak pernah melebihi harga: total tidak negatif", () => {
    const r = computeOrder({
      lines: [{ id: "a", unitPrice: 10_000, quantity: 1, discount: { kind: "amount", amount: 99_999 }, promoDiscount: 50_000 }],
      orderDiscount: { kind: "amount", amount: 99_999 },
      taxRatesBp: [1000],
      gratuityRatesBp: [500],
      settings: settings(),
    });
    expect(r.lines[0]).toMatchObject({ discount: 10_000, promoDiscount: 0, afterDiscount: 0 });
    expect(r).toMatchObject({ base: 0, net: 0, tax: 0, gratuity: 0, total: 0 });
  });

  it("promo dibatasi sampai sisa harga baris setelah diskon baris", () => {
    const r = computeOrder({
      lines: [{ id: "a", unitPrice: 10_000, quantity: 1, discount: { kind: "percent", bp: 5000 }, promoDiscount: 9_000 }],
      taxRatesBp: [], gratuityRatesBp: [], settings: settings(),
    });
    expect(r.lines[0]).toMatchObject({ discount: 5_000, promoDiscount: 5_000, afterDiscount: 0 });
  });

  it("discountAmount: persen dibulatkan setengah ke atas dan nominal dibatasi", () => {
    expect(discountAmount(15, { kind: "percent", bp: 1000 })).toBe(2);
    expect(discountAmount(100, { kind: "amount", amount: 500 })).toBe(100);
    expect(discountAmount(100, null)).toBe(0);
  });
});

describe("pembulatan akhir", () => {
  const base = { lines: one(99_999), taxRatesBp: [1000] as number[], gratuityRatesBp: [] as number[] };

  it("tanpa pembulatan: rounding = 0", () => {
    expect(computeOrder({ ...base, settings: settings() })).toMatchObject({ totalBeforeRounding: 109_999, rounding: 0, total: 109_999 });
  });

  it("terdekat (setengah ke atas) ke kelipatan 100", () => {
    expect(computeOrder({ ...base, settings: settings({ roundingStep: 100 }) })).toMatchObject({ rounding: 1, total: 110_000 });
    expect(computeOrder({ lines: one(115_550), taxRatesBp: [], gratuityRatesBp: [], settings: settings({ roundingStep: 100 }) }).total).toBe(115_600);
    expect(computeOrder({ lines: one(115_549), taxRatesBp: [], gratuityRatesBp: [], settings: settings({ roundingStep: 100 }) }).total).toBe(115_500);
  });

  it("ke atas dan ke bawah", () => {
    expect(computeOrder({ ...base, settings: settings({ roundingStep: 100, roundingMode: "up" }) }).total).toBe(110_000);
    expect(computeOrder({ ...base, settings: settings({ roundingStep: 100, roundingMode: "down" }) })).toMatchObject({ rounding: -99, total: 109_900 });
  });

  it("total sudah kelipatan: rounding 0", () => {
    expect(computeOrder({ lines: one(100_000), taxRatesBp: [], gratuityRatesBp: [], settings: settings({ roundingStep: 100, roundingMode: "up" }) }).rounding).toBe(0);
  });
});

describe("validasi", () => {
  it("menolak harga negatif/pecahan, jumlah < 1, tarif di luar 0-100%", () => {
    const ok = { taxRatesBp: [], gratuityRatesBp: [], settings: settings() };
    expect(() => computeOrder({ ...ok, lines: one(-1) })).toThrow(RangeError);
    expect(() => computeOrder({ ...ok, lines: one(1.5) })).toThrow(RangeError);
    expect(() => computeOrder({ ...ok, lines: one(100, 0) })).toThrow(RangeError);
    expect(() => computeOrder({ ...ok, lines: one(100), taxRatesBp: [10_001] })).toThrow(RangeError);
    expect(() => computeOrder({ ...ok, lines: one(100), gratuityRatesBp: [-1] })).toThrow(RangeError);
    expect(() => computeOrder({ ...ok, lines: one(100), orderDiscount: { kind: "percent", bp: 10_001 } })).toThrow(RangeError);
    expect(() => computeOrder({ ...ok, lines: one(100), settings: settings({ roundingStep: -5 }) })).toThrow(RangeError);
  });

  it("pesanan kosong menghasilkan semua nol", () => {
    const r = computeOrder({ lines: [], taxRatesBp: [1000], gratuityRatesBp: [500], settings: settings() });
    expect(r).toMatchObject({ subtotal: 0, base: 0, total: 0, tax: 0, gratuity: 0 });
  });
});

describe("sifat yang harus selalu benar (sapuan semua kombinasi)", () => {
  const taxSets = [[], [1000], [1100], [1000, 500]];
  const gratSets = [[], [500], [550, 100]];
  const flags = [false, true];
  const amounts = [...Array.from({ length: 1501 }, (_, i) => i), 9_999, 99_999, 123_457, 999_999_999, 8_999_999_999_999];

  it("untuk 8 kombinasi pengaturan, banyak tarif, dan ribuan harga", () => {
    let combos = 0;
    for (const incT of flags) for (const incG of flags) for (const tOnG of flags) {
      for (const taxRatesBp of taxSets) for (const gratuityRatesBp of gratSets) {
        const s = settings({ pricesIncludeTax: incT, pricesIncludeGratuity: incG, taxOnGratuity: tOnG });
        for (const price of amounts) {
          const r = computeOrder({ lines: one(price), taxRatesBp, gratuityRatesBp, settings: s });
          const label = JSON.stringify({ incT, incG, tOnG, taxRatesBp, gratuityRatesBp, price });
          for (const [k, v] of Object.entries({ net: r.net, gratuity: r.gratuity, tax: r.tax, taxOnGoods: r.taxOnGoods, taxOnGratuity: r.taxOnGratuity, total: r.total })) {
            expect(Number.isInteger(v) && v >= 0, `${k} tidak valid (${v}) untuk ${label}`).toBe(true);
          }
          expect(r.total, `total = net + gratuity + tax ${label}`).toBe(r.net + r.gratuity + r.tax);
          expect(r.total - r.addedOnTop, `bagian di dalam harga menu = harga ${label}`).toBe(r.base);
          expect(r.net, `net <= harga ${label}`).toBeLessThanOrEqual(r.base);
          expect(r.taxPerRate.reduce((a, b) => a + b, 0), `alokasi pajak ${label}`).toBe(r.tax);
          expect(r.gratuityPerRate.reduce((a, b) => a + b, 0), `alokasi gratuity ${label}`).toBe(r.gratuity);
          if (incT && incG) expect(r.total, `semua termasuk: total = harga ${label}`).toBe(price);
          if (!incT && !incG && taxRatesBp.length === 0 && gratuityRatesBp.length === 0) expect(r.total).toBe(price);
          combos++;
        }
      }
    }
    expect(combos).toBeGreaterThan(40_000);
  });

  it("selisih pembulatan komponen tertanam tidak lebih dari 2 satuan terkecil", () => {
    for (const incT of flags) for (const incG of flags) {
      const s = settings({ pricesIncludeTax: incT, pricesIncludeGratuity: incG });
      for (let price = 1; price <= 3000; price++) {
        const r = computeOrder({ lines: one(price), taxRatesBp: [1100], gratuityRatesBp: [550], settings: s });
        const expectedTax = Math.round((r.net * 1100) / 10_000);
        const expectedGrat = Math.round((r.net * 550) / 10_000);
        expect(Math.abs(r.taxOnGoods - expectedTax), `pajak barang price=${price} ${incT}/${incG}`).toBeLessThanOrEqual(2);
        expect(Math.abs(r.gratuity - expectedGrat), `gratuity price=${price} ${incT}/${incG}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("harga yang lebih tinggi tidak pernah menghasilkan total yang lebih rendah", () => {
    for (const incT of flags) for (const incG of flags) for (const tOnG of flags) {
      const s = settings({ pricesIncludeTax: incT, pricesIncludeGratuity: incG, taxOnGratuity: tOnG });
      let previous = -1;
      for (let price = 0; price <= 4000; price++) {
        const total = computeOrder({ lines: one(price), taxRatesBp: [1100], gratuityRatesBp: [550], settings: s }).total;
        expect(total, `monoton pada price=${price} ${incT}/${incG}/${tOnG}`).toBeGreaterThanOrEqual(previous);
        previous = total;
      }
    }
  });

  it("pembulatan: total akhir selalu kelipatan dan selisihnya kurang dari satu langkah", () => {
    for (const roundingMode of ["nearest", "up", "down"] as const) {
      for (let price = 0; price <= 2000; price += 7) {
        const r = computeOrder({ lines: one(price), taxRatesBp: [1100], gratuityRatesBp: [550], settings: settings({ roundingStep: 100, roundingMode }) });
        expect(r.total % 100).toBe(0);
        expect(Math.abs(r.rounding)).toBeLessThan(100);
        expect(r.total).toBe(r.totalBeforeRounding + r.rounding);
      }
    }
  });
});
