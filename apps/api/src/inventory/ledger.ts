import { and, asc, eq, inArray } from "drizzle-orm";
import { ingredients, newId, stockLevels, stockMovements, type DbHandle, type MovementKind, type SubjectType } from "@naqdi/db";
import { issue, receive, valueOf, type Level } from "@naqdi/domain";

type Db = DbHandle["db"];

export interface Subject {
  subjectType: SubjectType;
  subjectId: string;
}

export const keyOf = (s: Subject): string => `${s.subjectType}:${s.subjectId}`;

export interface LockedLevel extends Level {
  alertLow: number;
}

export interface MoveContext {
  businessId: string;
  outletId: string;
  userId: string | null;
  refType?: string | null;
  refId?: string | null;
  orderItemId?: string | null;
  note?: string | null;
}

/**
 * Menyiapkan baris saldo (bila belum ada) lalu MENGUNCINYA untuk transaksi berjalan. Urutan penguncian selalu sama
 * (varian dulu, lalu bahan, masing-masing urut id) agar dua transaksi yang berbarengan tidak saling menunggu (deadlock).
 * Biaya awal bahan diambil dari `defaultCost` bahan itu.
 */
export const lockLevels = async (tx: Db, outletId: string, subjects: readonly Subject[]): Promise<Map<string, LockedLevel>> => {
  const unique = [...new Map(subjects.map((s) => [keyOf(s), s])).values()];
  const out = new Map<string, LockedLevel>();
  if (unique.length === 0) return out;

  const ingredientIds = unique.filter((s) => s.subjectType === "ingredient").map((s) => s.subjectId);
  const defaults = new Map<string, number>();
  if (ingredientIds.length) {
    for (const r of await tx.select({ id: ingredients.id, cost: ingredients.defaultCost }).from(ingredients).where(inArray(ingredients.id, ingredientIds))) defaults.set(r.id, r.cost);
  }
  await tx
    .insert(stockLevels)
    .ignore()
    .values(unique.map((s) => ({ outletId, subjectType: s.subjectType, subjectId: s.subjectId, quantity: 0, avgCost: s.subjectType === "ingredient" ? (defaults.get(s.subjectId) ?? 0) : 0 })));

  for (const type of ["variant", "ingredient"] as const) {
    const ids = unique.filter((s) => s.subjectType === type).map((s) => s.subjectId).sort();
    if (ids.length === 0) continue;
    const rows = await tx
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.outletId, outletId), eq(stockLevels.subjectType, type), inArray(stockLevels.subjectId, ids)))
      .orderBy(asc(stockLevels.subjectId))
      .for("update");
    for (const r of rows) out.set(keyOf(r), { quantity: r.quantity, avgCost: r.avgCost, alertLow: r.alertLow });
  }
  return out;
};

/**
 * Satu pergerakan stok: memperbarui saldo (rata-rata tertimbang untuk masuk, biaya rata-rata untuk keluar), menulis buku besar,
 * dan memperbarui peta saldo yang dipegang pemanggil. `delta` bertanda; `unitCost` hanya dipakai untuk pergerakan masuk
 * (bila kosong dipakai biaya rata-rata saat ini).
 */
export const applyMove = async (
  tx: Db,
  ctx: MoveContext,
  levels: Map<string, LockedLevel>,
  subject: Subject,
  kind: MovementKind,
  delta: number,
  unitCost?: number,
): Promise<{ unitCost: number; value: number }> => {
  if (delta === 0) return { unitCost: 0, value: 0 };
  const k = keyOf(subject);
  const cur = levels.get(k);
  if (!cur) throw new Error(`saldo ${k} belum dikunci`);
  let next: Level;
  let cost: number;
  let value: number;
  if (delta > 0) {
    cost = unitCost ?? cur.avgCost;
    next = receive(cur, delta, cost);
    value = valueOf(delta, cost);
  } else {
    const r = issue(cur, -delta);
    next = r.level;
    cost = r.unitCost;
    value = r.value;
  }
  await tx
    .update(stockLevels)
    .set({ quantity: next.quantity, avgCost: next.avgCost, updatedAt: new Date() })
    .where(and(eq(stockLevels.outletId, ctx.outletId), eq(stockLevels.subjectType, subject.subjectType), eq(stockLevels.subjectId, subject.subjectId)));
  await tx.insert(stockMovements).values({
    id: newId(),
    businessId: ctx.businessId,
    outletId: ctx.outletId,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    kind,
    delta,
    unitCost: cost,
    value,
    balanceAfter: next.quantity,
    refType: ctx.refType ?? null,
    refId: ctx.refId ?? null,
    orderItemId: ctx.orderItemId ?? null,
    userId: ctx.userId,
    note: ctx.note ?? null,
  });
  levels.set(k, { ...cur, ...next });
  return { unitCost: cost, value };
};
