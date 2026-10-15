import { describe, expect, it } from "vitest";
import { RewardError, earnFromItems, earnFromSpend, itemRewardDiscounts, reversalPoints, totalRewardDiscount, type RewardDef } from "../src/index";

describe("poin dari belanja", () => {
  it("lantai per kelipatan: Rp 10.000 = 1 poin", () => {
    expect(earnFromSpend(105_600, { amount: 10_000, points: 1 })).toBe(10);
    expect(earnFromSpend(9_999, { amount: 10_000, points: 1 })).toBe(0);
    expect(earnFromSpend(25_000, { amount: 5_000, points: 3 })).toBe(15);
    expect(earnFromSpend(0, { amount: 10_000, points: 1 })).toBe(0);
    expect(() => earnFromSpend(1, { amount: 0, points: 1 })).toThrow(RangeError);
  });
});

describe("poin dari item", () => {
  const rules = [
    { itemId: "kopi", categoryId: null, pointsPerUnit: 5 },
    { itemId: null, categoryId: "minuman", pointsPerUnit: 2 },
  ];
  it("aturan item didahulukan dari kategori; baris tanpa aturan nol", () => {
    expect(earnFromItems([{ itemId: "kopi", categoryId: "minuman", quantity: 3 }], rules)).toBe(15);
    expect(earnFromItems([{ itemId: "teh", categoryId: "minuman", quantity: 2 }], rules)).toBe(4);
    expect(earnFromItems([{ itemId: "nasi", categoryId: "makanan", quantity: 9 }], rules)).toBe(0);
    expect(earnFromItems([{ itemId: null, categoryId: null, quantity: 1 }], rules)).toBe(0);
  });
});

describe("pengurangan poin saat refund", () => {
  it("refund bertahap menjumlah tepat sama dengan poin yang didapat", () => {
    for (const earned of [1, 7, 10, 33]) {
      for (const total of [10_000, 73_260, 99_999]) {
        const parts = [Math.floor(total / 3), Math.floor(total / 3)];
        parts.push(total - parts[0]! - parts[1]!);
        let before = 0;
        let sum = 0;
        for (const p of parts) {
          sum += reversalPoints(earned, total, before, p);
          before += p;
        }
        expect(sum).toBe(earned);
      }
    }
    expect(reversalPoints(0, 100, 0, 50)).toBe(0);
    expect(reversalPoints(10, 100, 0, 1000)).toBe(10); // tidak melebihi poin yang didapat
  });
});

const total = (over: Partial<RewardDef> = {}): RewardDef => ({ kind: "percent_total", valueKind: "percent", value: 1000, maxDiscount: null, minPurchase: 0, itemId: null, categoryId: null, ...over });

describe("reward total pesanan", () => {
  it("persen dengan batas maksimum; nominal tidak melebihi belanja", () => {
    expect(totalRewardDiscount(total(), 100_000)).toBe(10_000);
    expect(totalRewardDiscount(total({ maxDiscount: 7_000 }), 100_000)).toBe(7_000);
    expect(totalRewardDiscount(total({ kind: "amount_total", valueKind: "amount", value: 50_000 }), 30_000)).toBe(30_000);
  });
  it("minimum belanja", () => {
    expect(() => totalRewardDiscount(total({ minPurchase: 50_000 }), 49_999)).toThrow(RewardError);
    expect(totalRewardDiscount(total({ minPurchase: 50_000 }), 50_000)).toBe(5_000);
  });
});

describe("reward item/kategori", () => {
  const lines = [
    { key: "a", itemId: "kopi", categoryId: "minuman", unitPrice: 20_000, quantity: 2, hasDiscount: false },
    { key: "b", itemId: "teh", categoryId: "minuman", unitPrice: 10_000, quantity: 1, hasDiscount: false },
    { key: "c", itemId: "kopi", categoryId: "minuman", unitPrice: 20_000, quantity: 1, hasDiscount: true },
  ];
  const item = (over: Partial<RewardDef>): RewardDef => ({ kind: "item_discount", valueKind: "percent", value: 5000, maxDiscount: null, minPurchase: 0, itemId: null, categoryId: null, ...over });
  it("persen: semua baris cocok tanpa diskon baris", () => {
    const r = itemRewardDiscounts(item({ itemId: "kopi" }), lines);
    expect([...r.keys()]).toEqual(["a"]); // baris c sudah berdiskon
    expect(r.get("a")).toEqual({ kind: "percent", bp: 5000 });
    expect([...itemRewardDiscounts(item({ categoryId: "minuman" }), lines).keys()].sort()).toEqual(["a", "b"]);
  });
  it("nominal: satu unit pertama, tidak melebihi harga unit", () => {
    expect(itemRewardDiscounts(item({ itemId: "kopi", valueKind: "amount", value: 8_000 }), lines).get("a")).toEqual({ kind: "amount", amount: 8_000 });
    expect(itemRewardDiscounts(item({ itemId: "teh", valueKind: "amount", value: 99_000 }), lines).get("b")).toEqual({ kind: "amount", amount: 10_000 });
  });
  it("tidak ada yang cocok ditolak", () => {
    expect(() => itemRewardDiscounts(item({ itemId: "nasi" }), lines)).toThrow(RewardError);
  });
});
