import type { OfflinePrice, Settlement } from "@naqdi/domain";
import type { SaleOp } from "@naqdi/sync";
import type { OrderView } from "@/lib/posClient";

/** UUID v4. `crypto.randomUUID` hanya ada di konteks aman (HTTPS/localhost), sedangkan tablet bisa membuka lewat HTTP di jaringan lokal. */
export const newUuid = (): string => {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
};

/** Bentuk `OrderView` untuk struk sementara penjualan offline (belum punya nomor struk resmi dari server). */
export const offlineOrderView = (op: SaleOp, price: OfflinePrice, settlement: Settlement): OrderView => {
  const t = price.priced.totals;
  return {
    id: op.clientId,
    status: "paid",
    receiptNumber: null,
    offlineRef: op.clientRef,
    salesTypeId: op.salesTypeId,
    tableId: null,
    customerId: null,
    customer: null,
    rewardId: null,
    pointsEarned: 0,
    pointsRedeemed: 0,
    refundedTotal: 0,
    label: op.label ?? null,
    note: op.note ?? null,
    openedAt: op.createdAt,
    paidAt: op.createdAt,
    orderDiscount: op.orderDiscount,
    snapshot: price.priced.snapshot as unknown as OrderView["snapshot"],
    totals: {
      subtotal: t.subtotal,
      discountTotal: t.discountTotal,
      base: t.base,
      net: t.net,
      gratuity: t.gratuity,
      tax: t.tax,
      rounding: t.rounding,
      total: t.total,
      paid: settlement.paid,
      change: settlement.change,
    },
    lines: price.lines.map((l, i) => ({
      id: l.key,
      itemId: l.itemId,
      variantId: l.variantId,
      bundleId: l.bundleId,
      name: l.name,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      refundedQuantity: 0,
      discount: l.discount,
      lineDiscount: t.lines[i]?.discount ?? 0,
      orderDiscountShare: t.lines[i]?.orderDiscountShare ?? 0,
      promoDiscount: t.lines[i]?.promoDiscount ?? 0,
      note: l.note,
      modifiers: l.modifiers,
    })),
    payments: settlement.payments.map((p, i) => ({ id: String(i), method: p.method, tendered: p.tendered, applied: p.applied, change: p.change, reference: op.payments[i]?.reference ?? null })),
  };
};
