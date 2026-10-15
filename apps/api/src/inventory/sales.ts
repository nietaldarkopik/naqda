import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ingredients, itemVariants, items, orderItemModifiers, orderItems, outlets, stockMovements, type DbHandle } from "@naqdi/db";
import { cumulativeShare, findShortages, mergeRequirements, type Requirement } from "@naqdi/domain";
import { AppError } from "../errors";
import { applyMove, lockLevels } from "./ledger";
import { buildCostModel } from "./recipes";

type Db = DbHandle["db"];

interface Actor {
  businessId: string;
  outletId: string;
  userId: string;
}

const nameShortages = async (tx: Db, shortages: ReturnType<typeof findShortages>) => {
  const variantIds = shortages.filter((s) => s.subjectType === "variant").map((s) => s.subjectId);
  const ingredientIds = shortages.filter((s) => s.subjectType === "ingredient").map((s) => s.subjectId);
  const names = new Map<string, string>();
  if (variantIds.length) {
    for (const r of await tx.select({ id: itemVariants.id, item: items.name, variant: itemVariants.name }).from(itemVariants).innerJoin(items, eq(itemVariants.itemId, items.id)).where(inArray(itemVariants.id, variantIds))) {
      names.set(`variant:${r.id}`, r.variant && r.variant !== r.item ? `${r.item} (${r.variant})` : r.item);
    }
  }
  if (ingredientIds.length) {
    for (const r of await tx.select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit }).from(ingredients).where(inArray(ingredients.id, ingredientIds))) names.set(`ingredient:${r.id}`, `${r.name} (${r.unit})`);
  }
  return shortages.map((s) => ({ name: names.get(`${s.subjectType}:${s.subjectId}`) ?? "?", needed: s.needed / 1000, available: s.available / 1000 }));
};

/**
 * Memotong stok untuk pesanan yang sedang dibayar (dipanggil di dalam transaksi bayar, setelah pesanan dikunci).
 * Yang dipotong: varian item yang dilacak stoknya, bahan resep varian, bahan stok modifier, dan komponen paket.
 * Mode stok outlet: off = boleh minus; block = tolak bila kurang; override = tolak kecuali kasir menyetujui (`override`).
 * Mengembalikan jumlah bahan/varian yang stoknya kurang (stok menjadi minus hanya bila mode off atau `force`).
 */
export const deductForOrder = async (tx: Db, actor: Actor, orderId: string, override: boolean, force = false): Promise<number> => {
  const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position));
  if (lines.length === 0) return 0;
  const mods = await tx.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, lines.map((l) => l.id)));
  const optionsOf = (lineId: string) => mods.filter((m) => m.orderItemId === lineId).map((m) => m.optionId);

  const model = await buildCostModel(tx, actor.outletId, {
    variantIds: lines.flatMap((l) => (l.variantId ? [l.variantId] : [])),
    optionIds: mods.flatMap((m) => (m.optionId ? [m.optionId] : [])),
    bundleIds: lines.flatMap((l) => (l.bundleId ? [l.bundleId] : [])),
  });
  const perLine = lines.map((l) => ({
    line: l,
    reqs: model.unitRequirements({ variantId: l.variantId, bundleId: l.bundleId, optionIds: optionsOf(l.id) }).map((r) => ({ ...r, quantity: r.quantity * l.quantity })),
  }));
  const all = mergeRequirements(perLine.flatMap((x) => x.reqs));
  if (all.length === 0) return 0;

  const levels = await lockLevels(tx, actor.outletId, all);
  const [outlet] = await tx.select({ mode: outlets.stockMode }).from(outlets).where(eq(outlets.id, actor.outletId)).limit(1);
  const mode = outlet?.mode ?? "off";
  const short = findShortages(all, levels);
  // `force`: penjualan offline yang sudah terjadi dicatat apa adanya; stok boleh menjadi minus dan dilaporkan lewat jumlah kekurangan.
  if (mode !== "off" && !force && short.length > 0 && !(mode === "override" && override)) {
    throw new AppError("conflict", { messageKey: "pos.stockShort", extra: { short: await nameShortages(tx, short), canOverride: mode === "override" } });
  }

  for (const { line, reqs } of perLine) {
    for (const r of reqs) {
      await applyMove(tx, { ...actor, refType: "order", refId: orderId, orderItemId: line.id }, levels, r, "sale", -r.quantity);
    }
  }
  return short.length;
};

/**
 * Mengembalikan stok untuk unit yang di-refund (opsional). Yang dikembalikan sebanding unit dengan biaya saat dijual;
 * unit terakhir mendapat sisa sehingga total yang kembali tepat sama dengan yang dulu keluar.
 */
export const restockForRefund = async (tx: Db, actor: Actor, refundId: string, lines: { orderItemId: string; quantity: number }[]): Promise<void> => {
  if (lines.length === 0) return;
  const rows = await tx.select().from(orderItems).where(inArray(orderItems.id, lines.map((l) => l.orderItemId)));
  const sales = await tx
    .select()
    .from(stockMovements)
    .where(and(inArray(stockMovements.orderItemId, rows.map((r) => r.id)), eq(stockMovements.kind, "sale")));
  if (sales.length === 0) return;
  const subjects: Requirement[] = sales.map((s) => ({ subjectType: s.subjectType, subjectId: s.subjectId, quantity: 0 }));
  const levels = await lockLevels(tx, actor.outletId, subjects);
  for (const l of lines) {
    const row = rows.find((r) => r.id === l.orderItemId)!;
    for (const s of sales.filter((x) => x.orderItemId === row.id)) {
      const issued = -s.delta;
      const back = cumulativeShare(issued, row.quantity, row.restockedQuantity + l.quantity) - cumulativeShare(issued, row.quantity, row.restockedQuantity);
      if (back > 0) await applyMove(tx, { ...actor, refType: "refund", refId: refundId, orderItemId: row.id }, levels, s, "refund", back, s.unitCost);
    }
    await tx.update(orderItems).set({ restockedQuantity: sql`${orderItems.restockedQuantity} + ${l.quantity}` }).where(eq(orderItems.id, row.id));
  }
};
