import { describe, expect, it } from "vitest";
import { applyTaxes, mulDivRound, percentOf } from "../src/index";

describe("mulDivRound", () => {
  it("membulatkan setengah ke atas", () => {
    expect(mulDivRound(5, 1, 2)).toBe(3); // 2,5 -> 3
    expect(mulDivRound(4, 1, 3)).toBe(1); // 1,33 -> 1
    expect(mulDivRound(5, 1, 3)).toBe(2); // 1,67 -> 2
  });

  it("tetap tepat untuk nominal besar (di atas 2^53 pada hasil kali)", () => {
    // 9.000.000.000.000 * 10.000 = 9e16 > 2^53; float akan meleset.
    expect(mulDivRound(9_000_000_000_000, 1000, 10_000)).toBe(900_000_000_000);
    expect(mulDivRound(9_000_000_000_001, 1000, 10_000)).toBe(900_000_000_000); // 900.000.000.000,1
  });

  it("menolak masukan bukan integer atau pembagi nol", () => {
    expect(() => mulDivRound(1.5, 1, 2)).toThrow(RangeError);
    expect(() => mulDivRound(1, 1, 0)).toThrow(RangeError);
  });
});

describe("pajak eksklusif (harga belum termasuk pajak)", () => {
  it("menambahkan pajak di atas harga", () => {
    expect(applyTaxes(100_000, [1000], false)).toEqual({ net: 100_000, tax: 10_000, gross: 110_000, perTax: [10_000] });
  });

  it("tanpa pajak, bruto sama dengan harga", () => {
    expect(applyTaxes(50_000, [], false)).toEqual({ net: 50_000, tax: 0, gross: 50_000, perTax: [] });
    expect(applyTaxes(50_000, [0], false).tax).toBe(0);
  });

  it("membulatkan pajak setengah ke atas", () => {
    expect(applyTaxes(15, [1000], false).tax).toBe(2); // 1,5 -> 2
    expect(applyTaxes(14, [1000], false).tax).toBe(1); // 1,4 -> 1
  });
});

describe("pajak inklusif (harga sudah termasuk pajak)", () => {
  it("memisahkan pajak dari harga; total bayar tetap sama dengan harga", () => {
    const r = applyTaxes(110_000, [1000], true);
    expect(r).toEqual({ net: 100_000, tax: 10_000, gross: 110_000, perTax: [10_000] });
  });

  it("harga yang tidak habis dibagi: net dibulatkan, pajak = sisa, jumlah tetap tepat", () => {
    const r = applyTaxes(10_000, [1000], true); // 10000/1,1 = 9090,909
    expect(r.net).toBe(9091);
    expect(r.tax).toBe(909);
    expect(r.net + r.tax).toBe(10_000);
  });

  it("untuk semua harga 0..5000 dan beberapa tarif: net + pajak = harga tepat", () => {
    for (const rate of [0, 500, 1000, 1100, 1200, 2500]) {
      for (let amount = 0; amount <= 5000; amount++) {
        const r = applyTaxes(amount, [rate], true);
        expect(r.net + r.tax).toBe(amount);
        expect(r.gross).toBe(amount);
        expect(r.perTax.reduce((a, b) => a + b, 0)).toBe(r.tax);
      }
    }
  });

  it("net tidak pernah lebih besar dari harga dan tidak negatif", () => {
    for (let amount = 0; amount <= 2000; amount += 7) {
      const r = applyTaxes(amount, [1100], true);
      expect(r.net).toBeGreaterThanOrEqual(0);
      expect(r.net).toBeLessThanOrEqual(amount);
    }
  });
});

describe("beberapa pajak (tarif gabungan)", () => {
  it("inklusif: pajak 10% + 5% dari 11.500", () => {
    const r = applyTaxes(11_500, [1000, 500], true);
    expect(r.net).toBe(10_000);
    expect(r.tax).toBe(1_500);
    expect(r.perTax).toEqual([1_000, 500]);
  });

  it("eksklusif: sisa pembulatan masuk ke pajak terakhir sehingga jumlah tepat", () => {
    const r = applyTaxes(1_001, [333, 333, 334], false); // gabungan 10%
    expect(r.tax).toBe(100);
    expect(r.perTax.reduce((a, b) => a + b, 0)).toBe(r.tax);
  });

  it("mode inklusif dan eksklusif memberi bruto berbeda untuk harga menu yang sama", () => {
    const ex = applyTaxes(100_000, [1000], false);
    const inc = applyTaxes(100_000, [1000], true);
    expect(ex.gross).toBe(110_000); // pelanggan membayar lebih dari harga menu
    expect(inc.gross).toBe(100_000); // pelanggan membayar sesuai harga menu
    expect(inc.net).toBeLessThan(ex.net);
  });
});

describe("validasi", () => {
  it("menolak tarif di luar 0-10000 dan jumlah negatif atau pecahan", () => {
    expect(() => applyTaxes(1000, [10_001], false)).toThrow(RangeError);
    expect(() => applyTaxes(1000, [-1], false)).toThrow(RangeError);
    expect(() => applyTaxes(-1, [1000], false)).toThrow(RangeError);
    expect(() => applyTaxes(10.5, [1000], false)).toThrow(RangeError);
  });

  it("percentOf memakai pembulatan yang sama", () => {
    expect(percentOf(15, 1000)).toBe(2);
    expect(percentOf(9_000_000_000_000, 1000)).toBe(900_000_000_000);
  });
});
