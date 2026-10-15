import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { businesses, invoiceProofs, invoices, newId, type DbHandle } from "@naqdi/db";
import { isBusinessStatus, nextPeriodEnd, type BillingInterval } from "@naqdi/domain";
import { AppError } from "../errors";
import { iso } from "../http";
import { clearBillingCache } from "./access";

type Db = DbHandle["db"];
type InvoiceRow = typeof invoices.$inferSelect;
type ProofRow = typeof invoiceProofs.$inferSelect;

const DAY_MS = 86_400_000;
/** Faktur jatuh tempo sekian hari setelah dibuat (informasi untuk pelanggan; akses tetap mengikuti periode, bukan tanggal ini). */
export const INVOICE_DUE_DAYS = 7;
/** Faktur perpanjangan dibuat otomatis begitu sisa periode tinggal sekian hari. */
export const RENEWAL_LEAD_DAYS = 7;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newNumber = (now: Date): string => {
  const bytes = randomBytes(5);
  const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${d}-${code}`;
};

export interface NewInvoice {
  businessId: string;
  plan: string;
  interval: BillingInterval;
  amount: number;
  currency: string;
  custom?: boolean;
  note?: string | null;
}

/** Membuat faktur terbuka. Nomor acak diulang bila bentrok (sangat jarang). */
export const createInvoice = async (db: Db, input: NewInvoice, now = new Date()): Promise<InvoiceRow> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId();
    try {
      await db.insert(invoices).values({
        id,
        businessId: input.businessId,
        number: newNumber(now),
        plan: input.plan,
        interval: input.interval,
        amount: input.amount,
        currency: input.currency,
        status: "open",
        provider: "manual_transfer",
        custom: input.custom ? 1 : 0,
        note: input.note ?? null,
        dueAt: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS),
      });
      const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      return row!;
    } catch (e) {
      const text = e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "";
      if (!/invoices_number_uq/.test(text)) throw e;
    }
  }
  throw new AppError("server");
};

/** Faktur yang masih berjalan (open/pending) untuk bisnis ini. */
export const activeInvoice = async (db: Db, businessId: string): Promise<InvoiceRow | null> => {
  const rows = await db.select().from(invoices).where(eq(invoices.businessId, businessId)).orderBy(desc(invoices.createdAt)).limit(10);
  return rows.find((r) => r.status === "open" || r.status === "pending") ?? null;
};

export const latestProof = async (db: Db, invoiceId: string): Promise<ProofRow | null> => {
  const [p] = await db.select().from(invoiceProofs).where(eq(invoiceProofs.invoiceId, invoiceId)).orderBy(desc(invoiceProofs.createdAt)).limit(1);
  return p ?? null;
};

export const invoiceView = (row: InvoiceRow, proof?: ProofRow | null) => ({
  id: row.id,
  number: row.number,
  plan: row.plan,
  interval: row.interval,
  amount: row.amount,
  currency: row.currency,
  status: row.status,
  provider: row.provider,
  custom: row.custom === 1,
  note: row.note,
  dueAt: iso(row.dueAt),
  paidAt: iso(row.paidAt),
  rejectReason: row.rejectReason,
  createdAt: iso(row.createdAt),
  proof: proof ? { bank: proof.bank, sender: proof.sender, transferredOn: proof.transferredOn, note: proof.note, hasImage: proof.image !== null, at: iso(proof.createdAt) } : null,
});

/**
 * Menyetujui pembayaran: faktur lunas, paket dan siklus berlaku, periode DITAMBAH dari akhir periode berjalan (tidak ada hari hilang).
 * Satu transaksi dengan kunci baris pada faktur, jadi persetujuan ganda tidak menambah periode dua kali.
 * Bisnis yang ditangguhkan pengelola tetap ditangguhkan (pembayaran tidak membuka tangguhan), tetapi periodenya tetap ditambah.
 */
export const approveInvoice = async (db: Db, invoiceId: string, adminId: string, now = new Date()) => {
  const result = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update").limit(1);
    if (!inv) throw new AppError("not_found");
    if (inv.status !== "open" && inv.status !== "pending") throw new AppError("conflict", { messageKey: "billing.invoiceNotPayable" });
    const [biz] = await tx.select().from(businesses).where(eq(businesses.id, inv.businessId)).for("update").limit(1);
    if (!biz) throw new AppError("not_found");

    const status = isBusinessStatus(biz.status) ? biz.status : "active";
    // Periode berjalan hanya dihitung bila pelanggan memang sedang berlangganan; dari uji coba atau berhenti, mulai dari sekarang.
    const base = status === "active" || status === "past_due" || status === "suspended" ? biz.currentPeriodEndsAt : null;
    const periodEnd = nextPeriodEnd(inv.interval, base, now);
    await tx.update(invoices).set({ status: "paid", paidAt: now, reviewedBy: adminId, rejectReason: null }).where(eq(invoices.id, inv.id));
    await tx
      .update(businesses)
      .set({ plan: inv.plan, billingInterval: inv.interval, currentPeriodEndsAt: periodEnd, ...(status === "suspended" ? {} : { status: "active" }) })
      .where(eq(businesses.id, biz.id));
    return { businessId: biz.id, periodEnd, stillSuspended: status === "suspended", number: inv.number, plan: inv.plan, interval: inv.interval, amount: inv.amount, currency: inv.currency };
  });
  clearBillingCache(result.businessId);
  return result;
};

export const rejectInvoice = async (db: Db, invoiceId: string, adminId: string, reason: string) => {
  const res = await db
    .update(invoices)
    .set({ status: "open", reviewedBy: adminId, rejectReason: reason })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "pending")));
  const affected = (res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
  if (affected === 0) throw new AppError("conflict", { messageKey: "billing.invoiceNotPending" });
};
