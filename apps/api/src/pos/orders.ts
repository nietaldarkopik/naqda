import { eq, inArray } from "drizzle-orm";
import { newId, orderActivities, orderItemModifiers, orderItems, type DbHandle } from "@naqdi/db";
import type { PricedOrder, ResolvedLine } from "@naqdi/domain";
import type { PosAuthContext } from "../auth/tokens";

type Db = DbHandle["db"];

/** Catatan di jejak aktivitas kasir. `pos` cukup memuat bisnis, outlet, dan pelaku. */
export const logActivity = async (
  tx: Db,
  pos: Pick<PosAuthContext, "businessId" | "outletId" | "userId">,
  orderId: string | null,
  kind: string,
  detail: Record<string, unknown> | null,
  approvedBy: string | null = null,
) => {
  await tx.insert(orderActivities).values({ id: newId(), businessId: pos.businessId, outletId: pos.outletId, orderId, userId: pos.userId, approvedBy, kind, detail });
};

/** Mengganti seluruh baris order dengan `lines` (harga dibekukan sebagai salinan). Dipakai simpan bill dan sinkron offline. */
export const persistLines = async (tx: Db, order: { id: string; businessId: string }, lines: ResolvedLine[], priced: PricedOrder) => {
  const existing = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, order.id));
  if (existing.length) {
    await tx.delete(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, existing.map((e) => e.id)));
    await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
  }
  for (const [i, l] of lines.entries()) {
    const r = priced.totals.lines[i]!;
    const id = newId();
    await tx.insert(orderItems).values({
      id,
      businessId: order.businessId,
      orderId: order.id,
      position: i,
      itemId: l.itemId,
      variantId: l.variantId,
      bundleId: l.bundleId,
      categoryId: l.categoryId,
      name: l.name,
      sku: l.sku,
      unitPrice: l.unitPrice,
      basePrice: l.basePrice,
      cost: l.cost,
      quantity: l.quantity,
      discount: l.discount,
      lineDiscount: r.discount,
      orderDiscountShare: r.orderDiscountShare,
      promoDiscount: r.promoDiscount,
      promoId: r.promoDiscount > 0 ? (priced.promoByLine[l.key] ?? null) : null,
      note: l.note,
    });
    if (l.modifiers.length) {
      await tx.insert(orderItemModifiers).values(l.modifiers.map((m) => ({ id: newId(), orderItemId: id, optionId: m.optionId, name: m.name, price: m.price })));
    }
  }
};

export const totalsColumns = (t: PricedOrder["totals"]) => ({
  subtotal: t.subtotal,
  discountTotal: t.discountTotal,
  base: t.base,
  net: t.net,
  gratuity: t.gratuity,
  tax: t.tax,
  rounding: t.rounding,
  total: t.total,
});
