import { computeOrder, defaultOrderSettings, localMoment, splitRefund } from "@naqdi/domain";
import { describe, expect, it } from "vitest";
import { summarize, type Dataset, type SaleOrder } from "../src/reports/engine";

// Pesanan dibuat dengan mesin hitung yang sama dengan kasir, lalu diringkas: identitas harus berlaku untuk SEMUA mode pengaturan.
const order = (id: string, price: number, settings: Partial<typeof defaultOrderSettings>, tax: number[], gratuity: number[]): SaleOrder => {
  const r = computeOrder({ lines: [{ id: "l", unitPrice: price, quantity: 1 }], taxRatesBp: tax, gratuityRatesBp: gratuity, settings: { ...defaultOrderSettings, ...settings } });
  const at = new Date("2026-10-15T05:00:00Z");
  return {
    id, outletId: "o", userId: "u", salesTypeId: "s", tableId: null, pax: null, receiptNumber: 1, openedAt: at, paidAt: at,
    subtotal: r.subtotal, discountTotal: r.discountTotal, base: r.base, net: r.net, gratuity: r.gratuity, tax: r.tax, rounding: r.rounding, total: r.total,
    orderDiscount: null, snapshot: null, local: localMoment(at, "Asia/Jakarta"),
  };
};

const dataset = (orders: SaleOrder[], refundOf?: { order: SaleOrder; amount: number }): Dataset => ({
  orders,
  lines: [],
  payments: [],
  refunds: refundOf
    ? [{ id: "r", orderId: refundOf.order.id, outletId: "o", userId: "u", method: "cash", total: refundOf.amount, ...(() => { const p = splitRefund(refundOf.amount, refundOf.order); return { net: p.net, gratuity: p.gratuity, tax: p.tax }; })(), createdAt: new Date(), local: localMoment(new Date(), "UTC") }]
    : [],
  refundLines: [],
});

describe("identitas ringkasan di semua mode harga", () => {
  const modes: [string, Partial<typeof defaultOrderSettings>][] = [
    ["pajak ditambahkan", {}],
    ["harga sudah termasuk pajak", { pricesIncludeTax: true }],
    ["harga sudah termasuk pajak dan service", { pricesIncludeTax: true, pricesIncludeGratuity: true }],
    ["service di atas, pajak tidak atas service", { taxOnGratuity: false }],
    ["pembulatan 100 ke atas", { roundingStep: 100, roundingMode: "up" }],
    ["pembulatan 500 ke bawah + termasuk pajak", { roundingStep: 500, roundingMode: "down", pricesIncludeTax: true }],
  ];
  for (const [label, settings] of modes) {
    it(`${label}: net + service + pajak + pembulatan = total, dengan dan tanpa refund`, () => {
      const orders = [137_777, 99_999, 12_345, 250_000].map((p, i) => order(`o${i}`, p, settings, [1100], [500]));
      const plain = summarize(dataset(orders));
      expect(plain.netSales + plain.gratuity + plain.tax + plain.rounding).toBe(plain.totalCollected);
      expect(plain.grossSales - plain.discounts - plain.includedCharges).toBe(plain.netSales);
      const refunded = summarize(dataset(orders, { order: orders[0]!, amount: Math.floor(orders[0]!.total / 3) }));
      expect(refunded.netSales + refunded.gratuity + refunded.tax + refunded.rounding).toBe(refunded.totalCollected);
      expect(refunded.totalCollected).toBe(plain.totalCollected - Math.floor(orders[0]!.total / 3));
    });
  }
});
