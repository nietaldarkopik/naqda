import { and, count, eq, gte, inArray, isNull, max, ne } from "drizzle-orm";
import { devices, orders, outlets, roles, users, type DbHandle } from "@naqdi/db";

type Db = DbHandle["db"];

export interface BusinessStats {
  owner: { name: string; email: string } | null;
  outlets: number;
  devices: number;
  employees: number;
  orders30d: number;
  lastOrderAt: string | null;
}

const empty = (): BusinessStats => ({ owner: null, outlets: 0, devices: 0, employees: 0, orders30d: 0, lastOrderAt: null });

/**
 * Pemakaian beberapa bisnis sekaligus (untuk satu halaman daftar, bukan seluruh platform). Jumlah transaksi dihitung lewat
 * outlet agar memakai indeks (outlet_id, status, opened_at); `orders` tidak punya indeks business_id, dan menghitung per bisnis
 * lintas seluruh tabel akan lambat pada skala ribuan toko.
 */
export const businessStats = async (db: Db, ids: string[], now = new Date()): Promise<Map<string, BusinessStats>> => {
  const out = new Map<string, BusinessStats>(ids.map((id) => [id, empty()]));
  if (ids.length === 0) return out;

  const [outletCounts, deviceCounts, employeeCounts, owners, outletRows] = await Promise.all([
    db.select({ b: outlets.businessId, n: count() }).from(outlets).where(and(inArray(outlets.businessId, ids), isNull(outlets.deletedAt))).groupBy(outlets.businessId),
    db.select({ b: devices.businessId, n: count() }).from(devices).where(and(inArray(devices.businessId, ids), isNull(devices.revokedAt))).groupBy(devices.businessId),
    db.select({ b: users.businessId, n: count() }).from(users).where(and(inArray(users.businessId, ids), isNull(users.deletedAt), ne(users.status, "inactive"))).groupBy(users.businessId),
    db
      .select({ b: users.businessId, name: users.name, email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(inArray(users.businessId, ids), isNull(users.deletedAt), eq(roles.systemKey, "administrator")))
      .orderBy(users.createdAt),
    db.select({ id: outlets.id, b: outlets.businessId }).from(outlets).where(and(inArray(outlets.businessId, ids), isNull(outlets.deletedAt))),
  ]);
  for (const r of outletCounts) out.get(r.b)!.outlets = r.n;
  for (const r of deviceCounts) out.get(r.b)!.devices = r.n;
  for (const r of employeeCounts) out.get(r.b)!.employees = r.n;
  for (const r of owners) {
    const s = out.get(r.b);
    if (s && !s.owner) s.owner = { name: r.name, email: r.email }; // administrator tertua = pemilik
  }

  if (outletRows.length) {
    const businessOf = new Map(outletRows.map((o) => [o.id, o.b]));
    const outletIds = outletRows.map((o) => o.id);
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [recent, last] = await Promise.all([
      db.select({ o: orders.outletId, n: count() }).from(orders).where(and(inArray(orders.outletId, outletIds), eq(orders.status, "paid"), gte(orders.openedAt, since))).groupBy(orders.outletId),
      db.select({ o: orders.outletId, at: max(orders.openedAt) }).from(orders).where(and(inArray(orders.outletId, outletIds), eq(orders.status, "paid"))).groupBy(orders.outletId),
    ]);
    for (const r of recent) out.get(businessOf.get(r.o)!)!.orders30d += r.n;
    for (const r of last) {
      const s = out.get(businessOf.get(r.o)!)!;
      if (r.at && (!s.lastOrderAt || new Date(r.at).toISOString() > s.lastOrderAt)) s.lastOrderAt = new Date(r.at).toISOString();
    }
  }
  return out;
};
