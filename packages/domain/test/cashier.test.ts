import { describe, expect, it } from "vitest";
import {
  cashDifference,
  computeOrder,
  defaultOrderSettings,
  expectedCash,
  isValidPinFormat,
  isWeakPin,
  lockoutSeconds,
  PaymentError,
  settle,
  SplitError,
  splitLines,
  type OrderLineInput,
} from "../src/index";

describe("pembayaran (settle)", () => {
  it("tunai pas, tanpa kembalian", () => {
    expect(settle(50_000, [{ method: "cash", amount: 50_000 }])).toMatchObject({ paid: 50_000, remaining: 0, change: 0, fullyPaid: true, cashReceived: 50_000 });
  });

  it("tunai lebih: kembalian dihitung dan tunai bersih = tagihan", () => {
    const r = settle(48_395, [{ method: "cash", amount: 50_000 }]);
    expect(r).toMatchObject({ change: 1_605, fullyPaid: true, cashReceived: 48_395 });
    expect(r.payments[0]).toMatchObject({ tendered: 50_000, applied: 48_395, change: 1_605 });
  });

  it("non-tunai tepat sejumlah tagihan", () => {
    expect(settle(77_000, [{ method: "qris", amount: 77_000 }])).toMatchObject({ fullyPaid: true, change: 0, cashReceived: 0 });
  });

  it("pisah bayar: e-wallet sebagian, sisanya tunai dengan kembalian", () => {
    const r = settle(100_000, [{ method: "gopay", amount: 40_000 }, { method: "cash", amount: 100_000 }]);
    expect(r).toMatchObject({ paid: 100_000, remaining: 0, fullyPaid: true, change: 40_000, cashReceived: 60_000 });
  });

  it("urutan pembayaran tidak memengaruhi hasil", () => {
    const a = settle(100_000, [{ method: "cash", amount: 100_000 }, { method: "gopay", amount: 40_000 }]);
    expect(a).toMatchObject({ change: 40_000, cashReceived: 60_000, fullyPaid: true });
  });

  it("pembayaran sebagian: sisa tagihan tercatat", () => {
    const r = settle(100_000, [{ method: "cash", amount: 30_000 }]);
    expect(r).toMatchObject({ paid: 30_000, remaining: 70_000, fullyPaid: false, change: 0 });
  });

  it("non-tunai tidak boleh melebihi sisa tagihan", () => {
    expect(() => settle(50_000, [{ method: "card", amount: 60_000 }])).toThrow(PaymentError);
    expect(() => settle(50_000, [{ method: "gopay", amount: 30_000 }, { method: "ovo", amount: 30_000 }])).toThrow(/melebihi/);
  });

  it("tunai tidak diterima bila tagihan sudah lunas oleh non-tunai", () => {
    expect(() => settle(50_000, [{ method: "qris", amount: 50_000 }, { method: "cash", amount: 10_000 }])).toThrow(PaymentError);
  });

  it("menolak jumlah nol, negatif, atau pecahan; total negatif", () => {
    expect(() => settle(1000, [{ method: "cash", amount: 0 }])).toThrow(PaymentError);
    expect(() => settle(1000, [{ method: "cash", amount: -5 }])).toThrow(PaymentError);
    expect(() => settle(1000, [{ method: "cash", amount: 10.5 }])).toThrow(PaymentError);
    expect(() => settle(-1, [])).toThrow(RangeError);
  });

  it("tagihan nol: lunas tanpa pembayaran", () => {
    expect(settle(0, [])).toMatchObject({ fullyPaid: true, paid: 0, remaining: 0 });
  });

  it("tagihan nol tidak menerima tunai", () => {
    expect(() => settle(0, [{ method: "cash", amount: 1_000 }])).toThrow(PaymentError);
  });

  it("invarian: terapan + sisa = total; kembalian = diserahkan - terapan (disapu)", () => {
    for (let total = 13; total <= 400; total += 13) {
      for (const cash of [total, total + 1, total + 50, Math.max(1, total - 20)]) {
        if (cash < 1) continue;
        const r = settle(total, [{ method: "cash", amount: cash }]);
        expect(r.paid + r.remaining).toBe(total);
        expect(r.change).toBe(cash - r.cashReceived);
        expect(r.payments.reduce((a, p) => a + p.applied, 0)).toBe(r.paid);
      }
    }
  });
});

describe("pisah bill (splitLines)", () => {
  const lines: OrderLineInput[] = [
    { id: "a", unitPrice: 10_000, quantity: 3, discount: { kind: "amount", amount: 3_001 } },
    { id: "b", unitPrice: 5_000, quantity: 2, discount: { kind: "percent", bp: 1000 } },
    { id: "c", unitPrice: 20_000, quantity: 1 },
  ];

  it("memindahkan sebagian jumlah dan menyisakan sisanya", () => {
    const r = splitLines(lines, [{ lineId: "a", quantity: 1 }, { lineId: "c", quantity: 1 }]);
    expect(r.moved.map((l) => `${l.id}x${l.quantity}`)).toEqual(["ax1", "cx1"]);
    expect(r.kept.map((l) => `${l.id}x${l.quantity}`)).toEqual(["ax2", "b" + "x2"]);
  });

  it("diskon nominal dibagi sebanding dan jumlahnya tepat; persen ikut apa adanya", () => {
    const r = splitLines(lines, [{ lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }]);
    const amount = (l: OrderLineInput | undefined) => (l?.discount && l.discount.kind === "amount" ? l.discount.amount : 0);
    const movedA = r.moved.find((l) => l.id === "a");
    const keptA = r.kept.find((l) => l.id === "a");
    expect(amount(movedA) + amount(keptA)).toBe(3_001);
    expect(amount(movedA)).toBe(1_000); // 3001 x 1/3 dibulatkan
    expect(r.moved.find((l) => l.id === "b")?.discount).toEqual({ kind: "percent", bp: 1000 });
  });

  it("total kedua pesanan sama dengan total pesanan asal (tanpa pajak)", () => {
    const total = (ls: OrderLineInput[]) => computeOrder({ lines: ls, taxRatesBp: [], gratuityRatesBp: [], settings: defaultOrderSettings }).total;
    const r = splitLines(lines, [{ lineId: "a", quantity: 2 }, { lineId: "b", quantity: 1 }]);
    expect(total(r.kept) + total(r.moved)).toBe(total(lines));
  });

  it("untuk semua pembagian jumlah baris a, jumlah diskon nominal tetap tepat", () => {
    for (let q = 1; q <= 2; q++) {
      const r = splitLines(lines, [{ lineId: "a", quantity: q }]);
      const sum = [...r.kept, ...r.moved].filter((l) => l.id === "a").reduce((acc, l) => acc + (l.discount && l.discount.kind === "amount" ? l.discount.amount : 0), 0);
      expect(sum).toBe(3_001);
    }
  });

  it("menolak baris tidak dikenal, jumlah salah, tanpa pilihan, dan memindahkan semuanya", () => {
    expect(() => splitLines(lines, [{ lineId: "zzz", quantity: 1 }])).toThrow(SplitError);
    expect(() => splitLines(lines, [{ lineId: "a", quantity: 0 }])).toThrow(SplitError);
    expect(() => splitLines(lines, [{ lineId: "a", quantity: 4 }])).toThrow(SplitError);
    expect(() => splitLines(lines, [{ lineId: "a", quantity: 2 }, { lineId: "a", quantity: 2 }])).toThrow(SplitError);
    expect(() => splitLines(lines, [])).toThrow(SplitError);
    expect(() =>
      splitLines(lines, [{ lineId: "a", quantity: 3 }, { lineId: "b", quantity: 2 }, { lineId: "c", quantity: 1 }]),
    ).toThrow(/menyisakan/);
  });

  it("diskon promo tidak dibawa (dihitung ulang setelah pisah)", () => {
    const r = splitLines([{ id: "a", unitPrice: 100, quantity: 2, promoDiscount: 50 }, { id: "b", unitPrice: 10, quantity: 1 }], [{ lineId: "a", quantity: 1 }]);
    expect([...r.kept, ...r.moved].every((l) => !l.promoDiscount)).toBe(true);
  });
});

describe("kas shift", () => {
  it("uang yang diharapkan = modal + penjualan tunai - refund tunai + kas masuk - kas keluar", () => {
    expect(expectedCash({ openingCash: 150_000, cashSales: 685_364, cashRefunds: 35_200, cashIn: 0, cashOut: 30_000 })).toBe(770_164);
  });

  it("selisih: negatif = kurang, positif = lebih, nol = pas", () => {
    expect(cashDifference(770_164, 770_164)).toBe(0);
    expect(cashDifference(765_000, 770_164)).toBe(-5_164);
    expect(cashDifference(771_000, 770_164)).toBe(836);
  });

  it("menolak nilai negatif atau pecahan", () => {
    expect(() => expectedCash({ openingCash: -1, cashSales: 0, cashRefunds: 0, cashIn: 0, cashOut: 0 })).toThrow(RangeError);
    expect(() => expectedCash({ openingCash: 0, cashSales: 1.5, cashRefunds: 0, cashIn: 0, cashOut: 0 })).toThrow(RangeError);
    expect(() => cashDifference(-1, 0)).toThrow(RangeError);
  });

  it("konsisten dengan penyelesaian pembayaran: tunai bersih masuk laci", () => {
    const a = settle(48_395, [{ method: "cash", amount: 50_000 }]);
    const b = settle(77_000, [{ method: "gopay", amount: 77_000 }]);
    const c = settle(100_000, [{ method: "gopay", amount: 40_000 }, { method: "cash", amount: 100_000 }]);
    const cashSales = a.cashReceived + b.cashReceived + c.cashReceived;
    expect(cashSales).toBe(48_395 + 0 + 60_000);
    expect(expectedCash({ openingCash: 100_000, cashSales, cashRefunds: 0, cashIn: 0, cashOut: 0 })).toBe(208_395);
  });
});

describe("kebijakan PIN", () => {
  it("format: 4 sampai 6 digit angka", () => {
    for (const ok of ["1357", "24680", "135792"]) expect(isValidPinFormat(ok)).toBe(true);
    for (const bad of ["", "123", "1234567", "12a4", "12 34", "١٢٣٤"]) expect(isValidPinFormat(bad)).toBe(false);
  });

  it("PIN lemah: sama semua, berurutan, atau berulang", () => {
    for (const weak of ["0000", "1111", "123456", "1234", "4321", "9876", "1212", "123123", "abcd", "12"]) expect(isWeakPin(weak), weak).toBe(true);
    for (const strong of ["1357", "2468", "8052", "615243", "90417"]) expect(isWeakPin(strong), strong).toBe(false);
  });

  it("penguncian: bebas 4 kali salah, lalu 30 detik dan berlipat, maksimal 30 menit", () => {
    expect([0, 1, 2, 3, 4].map(lockoutSeconds)).toEqual([0, 0, 0, 0, 0]);
    expect([5, 6, 7, 8].map(lockoutSeconds)).toEqual([30, 60, 120, 240]);
    expect(lockoutSeconds(11)).toBe(1800);
    expect(lockoutSeconds(100)).toBe(1800);
    expect(() => lockoutSeconds(-1)).toThrow(RangeError);
  });
});
