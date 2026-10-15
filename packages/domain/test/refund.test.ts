import { describe, expect, it } from "vitest";
import { RefundError, allocateToLines, computeRefund, type RefundLineInput } from "../src/index";

const lines = (over: Partial<RefundLineInput>[] = []): RefundLineInput[] =>
  [
    { id: "A", weight: 40_000, quantity: 2, refundedQuantity: 0 },
    { id: "B", weight: 13_000, quantity: 1, refundedQuantity: 0 },
  ].map((l, i) => ({ ...l, ...(over[i] ?? {}) }));

describe("refund", () => {
  it("membagi total (termasuk pajak dan service) ke baris sebanding bobot, jumlah tepat", () => {
    const shares = allocateToLines(67_337, lines());
    expect(shares.reduce((a, b) => a + b, 0)).toBe(67_337);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
  });

  it("refund sebagian: satu unit dari dua", () => {
    const r = computeRefund(67_337, lines(), [{ lineId: "A", quantity: 1 }]);
    const share = allocateToLines(67_337, lines())[0]!;
    expect(r.total).toBe(Math.round(share / 2));
  });

  it("jika semua unit di-refund (bertahap), jumlahnya tepat sama dengan total dibayar", () => {
    for (const total of [67_337, 1, 99_999, 100_001, 123_457]) {
      const L = lines();
      const first = computeRefund(total, L, [{ lineId: "A", quantity: 1 }]);
      const second = computeRefund(total, lines([{ refundedQuantity: 1 }]), [{ lineId: "A", quantity: 1 }, { lineId: "B", quantity: 1 }]);
      expect(first.total + second.total).toBe(total);
    }
  });

  it("jumlah melebihi sisa, baris tak dikenal, jumlah nol, dan pilihan kosong ditolak", () => {
    expect(() => computeRefund(1000, lines([{ refundedQuantity: 2 }]), [{ lineId: "A", quantity: 1 }])).toThrow(RefundError);
    expect(() => computeRefund(1000, lines(), [{ lineId: "Z", quantity: 1 }])).toThrow(RefundError);
    expect(() => computeRefund(1000, lines(), [{ lineId: "A", quantity: 0 }])).toThrow(RefundError);
    expect(() => computeRefund(1000, lines(), [])).toThrow(RefundError);
  });

  it("baris gratis (bobot 0) di-refund Rp 0 dan tidak menyerap total", () => {
    const L: RefundLineInput[] = [
      { id: "F", weight: 0, quantity: 1, refundedQuantity: 0 },
      { id: "P", weight: 10_000, quantity: 1, refundedQuantity: 0 },
    ];
    expect(computeRefund(11_000, L, [{ lineId: "F", quantity: 1 }]).total).toBe(0);
    expect(computeRefund(11_000, L, [{ lineId: "P", quantity: 1 }]).total).toBe(11_000);
  });

  it("sapuan: refund bertahap satu-satu selalu berjumlah total, tidak pernah melebihi", () => {
    for (let total = 0; total < 2000; total += 37) {
      for (const weights of [[1, 1, 1], [5, 3], [100, 0, 7]]) {
        const L: RefundLineInput[] = weights.map((w, i) => ({ id: `L${i}`, weight: w, quantity: 3, refundedQuantity: 0 }));
        let sum = 0;
        for (const l of L) for (let k = 0; k < 3; k++) sum += computeRefund(total, L.map((x) => (x.id === l.id ? { ...x, refundedQuantity: k } : x)), [{ lineId: l.id, quantity: 1 }]).total;
        if (weights.some((w) => w > 0)) expect(sum).toBe(total);
      }
    }
  });
});
