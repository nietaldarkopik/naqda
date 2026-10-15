import { describe, expect, it } from "vitest";
import { cumulativeShare, findShortages, fromScaled, issue, mergeRequirements, receive, recipeCost, toScaled, valueOf } from "../src/index";

describe("skala jumlah", () => {
  it("desimal <= 3 angka menjadi integer, lebih presisi ditolak", () => {
    expect(toScaled(2.5)).toBe(2500);
    expect(toScaled(0.001)).toBe(1);
    expect(toScaled(0.1 + 0.2)).toBe(300); // kesalahan float diabaikan
    expect(fromScaled(2500)).toBe(2.5);
    expect(() => toScaled(0.0001)).toThrow(RangeError);
    expect(() => toScaled(Number.NaN)).toThrow(RangeError);
  });

  it("nilai = jumlah x biaya, dibulatkan menjauhi nol", () => {
    expect(valueOf(toScaled(7.5), toScaled(15))).toBe(113); // 112,5 -> 113
    expect(valueOf(toScaled(-7.5), toScaled(15))).toBe(-113);
    expect(valueOf(0, 5000)).toBe(0);
    expect(valueOf(toScaled(1_000_000), toScaled(1_000_000))).toBe(1_000_000_000_000); // tanpa luapan float
  });
});

describe("rata-rata tertimbang", () => {
  it("pembelian bertahap: 10 @ Rp100, lalu 30 @ Rp200 -> 40 @ Rp175", () => {
    const a = receive({ quantity: 0, avgCost: 0 }, toScaled(10), toScaled(100));
    const b = receive(a, toScaled(30), toScaled(200));
    expect(b).toEqual({ quantity: toScaled(40), avgCost: toScaled(175) });
  });

  it("keluar tidak mengubah biaya rata-rata; nilai keluar = jumlah x biaya", () => {
    const lvl = { quantity: toScaled(40), avgCost: toScaled(175) };
    const out = issue(lvl, toScaled(8));
    expect(out.level).toEqual({ quantity: toScaled(32), avgCost: toScaled(175) });
    expect(out.value).toBe(-1400);
    expect(out.unitCost).toBe(toScaled(175));
  });

  it("saldo kosong atau negatif memakai biaya masuk yang baru", () => {
    expect(receive({ quantity: 0, avgCost: toScaled(999) }, toScaled(5), toScaled(10))).toEqual({ quantity: toScaled(5), avgCost: toScaled(10) });
    expect(receive({ quantity: toScaled(-3), avgCost: toScaled(999) }, toScaled(5), toScaled(10))).toEqual({ quantity: toScaled(2), avgCost: toScaled(10) });
  });

  it("sapuan: nilai persediaan tidak pernah menyimpang lebih dari pembulatan, urutan penerimaan tak mengubah jumlah", () => {
    for (let i = 1; i <= 200; i++) {
      const lots: [number, number][] = [[toScaled(i), toScaled(i * 3 + 1)], [toScaled(i + 7), toScaled(i + 11)], [toScaled(2.5), toScaled(13.37)]];
      let lvl = { quantity: 0, avgCost: 0 };
      let sum = 0;
      for (const [q, c] of lots) {
        lvl = receive(lvl, q, c);
        sum += valueOf(q, c);
      }
      expect(Math.abs(valueOf(lvl.quantity, lvl.avgCost) - sum)).toBeLessThanOrEqual(lots.length);
    }
  });

  it("jumlah masuk/keluar nol atau negatif ditolak", () => {
    expect(() => receive({ quantity: 0, avgCost: 0 }, 0, 1)).toThrow(RangeError);
    expect(() => issue({ quantity: 5, avgCost: 1 }, -1)).toThrow(RangeError);
  });
});

describe("resep dan pengembalian ke stok", () => {
  it("biaya resep: 18 g kopi @ Rp 150/g + 200 ml susu @ Rp 18/ml = Rp 6.300", () => {
    expect(recipeCost([{ quantity: toScaled(18), cost: toScaled(150) }, { quantity: toScaled(200), cost: toScaled(18) }])).toBe(6300);
  });

  it("bagian kumulatif: semua unit dikembalikan = total keluar, tepat", () => {
    for (const total of [1, 7, 10_000, 33_333]) {
      for (const q of [1, 3, 7]) {
        let back = 0;
        for (let k = 0; k < q; k++) back += cumulativeShare(total, q, k + 1) - cumulativeShare(total, q, k);
        expect(back).toBe(total);
      }
    }
  });
});

describe("kebutuhan stok", () => {
  it("menggabungkan subjek yang sama dan mengurutkan stabil", () => {
    const merged = mergeRequirements([
      { subjectType: "ingredient", subjectId: "b", quantity: 5 },
      { subjectType: "ingredient", subjectId: "a", quantity: 2 },
      { subjectType: "ingredient", subjectId: "b", quantity: 7 },
    ]);
    expect(merged).toEqual([
      { subjectType: "ingredient", subjectId: "a", quantity: 2 },
      { subjectType: "ingredient", subjectId: "b", quantity: 12 },
    ]);
  });

  it("kekurangan: kebutuhan melebihi saldo; subjek tanpa saldo dianggap nol", () => {
    const levels = new Map([["ingredient:a", { quantity: 10, avgCost: 1 }]]);
    expect(findShortages([{ subjectType: "ingredient", subjectId: "a", quantity: 10 }, { subjectType: "ingredient", subjectId: "b", quantity: 1 }], levels)).toEqual([
      { subjectType: "ingredient", subjectId: "b", needed: 1, available: 0 },
    ]);
  });
});
