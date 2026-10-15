import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  auditLogs,
  customers,
  feedback,
  loyaltyLedger,
  loyaltyRedemptions,
  orders,
  receiptOutbox,
  smsOutbox,
  type DbHandle,
} from "@naqdi/db";

type Db = DbHandle["db"];

/** Pengganti teks pribadi yang dihapus. Konstanta agar mudah dikenali di laporan dan audit. */
export const ERASED = "(data dihapus)";

export interface ErasureReport {
  orders: number;
  smsMessages: number;
  receiptMessages: number;
  feedback: number;
  ledgerNotes: number;
  auditRows: number;
}

/**
 * Menghapus data pribadi seorang pelanggan (hak hapus / anonimisasi). Barisnya TETAP ADA agar transaksi, poin, dan laporan
 * tidak rusak, tetapi semua yang mengidentifikasi orangnya dibuang dari tempat mana pun ia tersalin:
 * - pelanggan: nama diganti, telepon/email/catatan dikosongkan, persetujuan dihapus, disembunyikan dari daftar;
 * - order: nama pelanggan di `pricing_snapshot` (yang membekukan nama saat transaksi);
 * - pesan keluar SMS dan struk (nomor telepon/email tujuan dan isi pesan);
 * - masukan pelanggan: komentar dan balasannya (rating tetap sebagai statistik);
 * - catatan manual di buku besar poin;
 * - jejak audit entitas pelanggan itu (ringkasan dan perubahan berisi nama/kontak).
 * Jejak audit bersifat hanya-tambah, dan ini satu-satunya pengecualian yang disengaja; penghapusannya sendiri dicatat tanpa data pribadi.
 * Mengembalikan null bila pelanggan tidak ada di bisnis ini atau sudah dianonimkan. Panggil di dalam transaksi.
 */
export const eraseCustomer = async (tx: Db, businessId: string, customerId: string): Promise<ErasureReport | null> => {
  const [c] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId), isNull(customers.anonymizedAt)))
    .limit(1);
  if (!c) return null;

  const orderIds = (await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.businessId, businessId), eq(orders.customerId, customerId)))).map((o) => o.id);
  const affected = async (p: Promise<unknown>): Promise<number> => ((await p) as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;

  const report: ErasureReport = { orders: 0, smsMessages: 0, receiptMessages: 0, feedback: 0, ledgerNotes: 0, auditRows: 0 };

  if (orderIds.length) {
    // Kolom uuid disimpan BINARY(16): pembandingan harus lewat kolom/builder, bukan string UUID di SQL mentah.
    report.orders = await affected(
      tx
        .update(orders)
        .set({ pricingSnapshot: sql`JSON_SET(${orders.pricingSnapshot}, '$.customer.name', ${ERASED})` })
        .where(and(eq(orders.businessId, businessId), eq(orders.customerId, customerId), sql`JSON_EXTRACT(${orders.pricingSnapshot}, '$.customer') IS NOT NULL`)),
    );
    report.receiptMessages = await affected(
      tx.update(receiptOutbox).set({ destination: ERASED }).where(and(eq(receiptOutbox.businessId, businessId), inArray(receiptOutbox.orderId, orderIds))),
    );
  }
  report.smsMessages = await affected(
    tx.update(smsOutbox).set({ phone: ERASED, body: ERASED }).where(and(eq(smsOutbox.businessId, businessId), eq(smsOutbox.customerId, customerId))),
  );
  report.feedback = await affected(
    tx.update(feedback).set({ comment: null, reply: null }).where(and(eq(feedback.businessId, businessId), eq(feedback.customerId, customerId))),
  );
  report.ledgerNotes = await affected(
    tx.update(loyaltyLedger).set({ note: null }).where(and(eq(loyaltyLedger.businessId, businessId), eq(loyaltyLedger.customerId, customerId))),
  );
  report.auditRows = await affected(
    tx
      .update(auditLogs)
      .set({ summary: ERASED, changes: null })
      .where(and(eq(auditLogs.businessId, businessId), eq(auditLogs.entityType, "customer"), eq(auditLogs.entityId, customerId))),
  );

  const now = new Date();
  await tx
    .update(customers)
    .set({ name: ERASED, phone: null, email: null, note: null, consentAt: null, anonymizedAt: now, deletedAt: sql`COALESCE(${customers.deletedAt}, ${now})` })
    .where(eq(customers.id, customerId));
  return report;
};

/**
 * Semua data yang disimpan tentang seorang pelanggan (hak akses/portabilitas), siap diunduh sebagai JSON.
 * Mengembalikan null bila tidak ada atau sudah dianonimkan.
 */
export const exportCustomerData = async (db: Db, businessId: string, customerId: string) => {
  const [c] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId), isNull(customers.anonymizedAt)))
    .limit(1);
  if (!c) return null;
  const [ledger, redemptions, fb, ords] = await Promise.all([
    db.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.businessId, businessId), eq(loyaltyLedger.customerId, customerId))).orderBy(desc(loyaltyLedger.createdAt)),
    db.select().from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.businessId, businessId), eq(loyaltyRedemptions.customerId, customerId))),
    db.select().from(feedback).where(and(eq(feedback.businessId, businessId), eq(feedback.customerId, customerId))).orderBy(desc(feedback.createdAt)),
    db.select().from(orders).where(and(eq(orders.businessId, businessId), eq(orders.customerId, customerId))).orderBy(desc(orders.openedAt)),
  ]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    generatedAt: new Date().toISOString(),
    customer: {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      note: c.note,
      memberSince: iso(c.memberSince),
      consentAt: iso(c.consentAt),
      points: c.points,
      lifetimeSpending: c.lifetimeSpending,
      visits: c.visits,
      createdAt: iso(c.createdAt),
    },
    orders: ords.map((o) => ({ id: o.id, receiptNumber: o.receiptNumber, status: o.status, openedAt: iso(o.openedAt), paidAt: iso(o.paidAt), total: o.total, refundedTotal: o.refundedTotal, pointsEarned: o.pointsEarned, pointsRedeemed: o.pointsRedeemed })),
    loyaltyLedger: ledger.map((l) => ({ at: iso(l.createdAt), kind: l.kind, points: l.points, balanceAfter: l.balanceAfter, note: l.note })),
    loyaltyRedemptions: redemptions.map((r) => ({ at: iso(r.createdAt), orderId: r.orderId, points: r.points, discount: r.discount })),
    feedback: fb.map((f) => ({ at: iso(f.createdAt), rating: f.rating, comment: f.comment, reply: f.reply })),
  };
};

/**
 * Pelanggan yang datanya masih utuh tetapi sudah lama tidak aktif: tanpa transaksi dibayar, mutasi poin, atau perubahan
 * sejak `months` bulan lalu. Dipakai kebijakan retensi (dry-run lalu hapus).
 */
export const inactiveCustomers = async (db: Db, businessId: string, months: number, now = new Date()): Promise<{ id: string; name: string; lastActivity: string }[]> => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      updatedAt: customers.updatedAt,
      // Tabel luar ditulis eksplisit: drizzle merender kolom tanpa nama tabel, yang di subkueri akan terikat ke kolom tabel dalam.
      lastOrder: sql<Date | null>`(SELECT MAX(o.paid_at) FROM orders o WHERE o.customer_id = customers.id)`,
      lastLedger: sql<Date | null>`(SELECT MAX(l.created_at) FROM loyalty_ledger l WHERE l.customer_id = customers.id)`,
    })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), isNull(customers.anonymizedAt), lt(customers.updatedAt, cutoff)));
  const out: { id: string; name: string; lastActivity: string }[] = [];
  for (const r of rows) {
    const times = [r.updatedAt, r.lastOrder ? new Date(r.lastOrder) : null, r.lastLedger ? new Date(r.lastLedger) : null].filter((t): t is Date => t !== null && !Number.isNaN(t.getTime()));
    const last = new Date(Math.max(...times.map((t) => t.getTime())));
    if (last < cutoff) out.push({ id: r.id, name: r.name, lastActivity: last.toISOString() });
  }
  return out;
};
