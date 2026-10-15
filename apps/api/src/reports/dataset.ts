import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { orderItems, orders, payments, refundItems, refunds, type DbHandle } from "@naqdi/db";
import { localMoment, localRangeUtc } from "@naqdi/domain";
import type { Dataset, RefundLineRec, SaleLine } from "./engine";

type Db = DbHandle["db"];

export interface ReportOutlet {
  id: string;
  name: string;
  timezone: string;
}

export interface ReportScope {
  businessId: string;
  outlets: ReportOutlet[];
  from: string;
  to: string;
}

/** Batas keamanan: rentang terlalu besar ditolak agar satu permintaan tidak memuat jutaan baris ke memori. */
export const MAX_ORDERS = 100_000;

export const chunk = <T>(xs: readonly T[], size = 1000): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** Kondisi "waktu berada di rentang tanggal setempat" untuk tiap outlet (zona waktu berbeda per outlet). */
export const windowCondition = (
  scope: ReportScope,
  outletCol: Parameters<typeof eq>[0],
  timeCol: Parameters<typeof gte>[0],
) =>
  or(
    ...scope.outlets.map((o) => {
      const r = localRangeUtc(scope.from, scope.to, o.timezone);
      return and(eq(outletCol, o.id), gte(timeCol, r.start), lt(timeCol, r.end));
    }),
  );

const toLine = (r: typeof orderItems.$inferSelect): SaleLine => ({
  id: r.id,
  orderId: r.orderId,
  itemId: r.itemId,
  categoryId: r.categoryId,
  bundleId: r.bundleId,
  name: r.name,
  quantity: r.quantity,
  unitPrice: r.unitPrice,
  cost: r.cost,
  lineDiscount: r.lineDiscount,
  promoDiscount: r.promoDiscount,
  orderDiscountShare: r.orderDiscountShare,
  discount: r.discount as SaleLine["discount"],
  promoId: r.promoId,
});

export class RangeTooLarge extends Error {}

/**
 * Memuat penjualan lunas pada rentang tanggal setempat (menurut waktu bayar) dan refund pada rentang yang sama
 * (menurut waktu refund; boleh dari pesanan yang dibayar sebelum rentang).
 */
export const loadDataset = async (db: Db, scope: ReportScope): Promise<Dataset> => {
  if (scope.outlets.length === 0) return { orders: [], lines: [], payments: [], refunds: [], refundLines: [] };
  const tz = new Map(scope.outlets.map((o) => [o.id, o.timezone]));

  const orderRows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, scope.businessId), eq(orders.status, "paid"), windowCondition(scope, orders.outletId, orders.paidAt)))
    .limit(MAX_ORDERS + 1);
  if (orderRows.length > MAX_ORDERS) throw new RangeTooLarge();

  const ids = orderRows.map((o) => o.id);
  const lines: SaleLine[] = [];
  const pays: Dataset["payments"] = [];
  for (const part of chunk(ids)) {
    for (const r of await db.select().from(orderItems).where(inArray(orderItems.orderId, part))) lines.push(toLine(r));
    for (const p of await db.select().from(payments).where(inArray(payments.orderId, part))) pays.push({ orderId: p.orderId, method: p.method, applied: p.applied });
  }

  const refundRows = await db
    .select()
    .from(refunds)
    .where(and(eq(refunds.businessId, scope.businessId), windowCondition(scope, refunds.outletId, refunds.createdAt)));
  const refundLines: RefundLineRec[] = [];
  for (const part of chunk(refundRows.map((r) => r.id))) {
    const rows = await db
      .select({ ri: refundItems, line: orderItems })
      .from(refundItems)
      .innerJoin(orderItems, eq(refundItems.orderItemId, orderItems.id))
      .where(inArray(refundItems.refundId, part));
    for (const r of rows) refundLines.push({ refundId: r.ri.refundId, line: toLine(r.line), quantity: r.ri.quantity, amount: r.ri.amount });
  }

  return {
    orders: orderRows.map((o) => ({
      id: o.id,
      outletId: o.outletId,
      userId: o.userId,
      salesTypeId: o.salesTypeId,
      tableId: o.tableId,
      pax: o.pax,
      receiptNumber: o.receiptNumber,
      openedAt: o.openedAt,
      paidAt: o.paidAt!,
      subtotal: o.subtotal,
      discountTotal: o.discountTotal,
      base: o.base,
      net: o.net,
      gratuity: o.gratuity,
      tax: o.tax,
      rounding: o.rounding,
      total: o.total,
      orderDiscount: o.orderDiscount,
      snapshot: o.pricingSnapshot as Dataset["orders"][number]["snapshot"],
      local: localMoment(o.paidAt!, tz.get(o.outletId) ?? "UTC"),
    })),
    lines,
    payments: pays,
    refunds: refundRows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      outletId: r.outletId,
      userId: r.userId,
      method: r.method,
      total: r.total,
      net: r.netAmount,
      gratuity: r.gratuityAmount,
      tax: r.taxAmount,
      createdAt: r.createdAt,
      local: localMoment(r.createdAt, tz.get(r.outletId) ?? "UTC"),
    })),
    refundLines,
  };
};
