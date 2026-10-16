import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";
import { mailQueue, newId, type DbHandle, type MailStatus } from "@naqdi/db";
import type { Locale } from "@naqdi/i18n";
import { logLine } from "../logging";
import { renderMail, type MailData, type MailKind } from "./templates";
import type { MailTransport } from "./transport";

type Db = DbHandle["db"];

/** Jeda sebelum percobaan ke-2, 3, 4, 5 (menit). Setelah percobaan ke-5 gagal, status menjadi "failed". */
export const RETRY_DELAYS_MIN = [1, 5, 30, 120] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
/** Status "sending" yang tidak selesai selama ini dianggap macet (proses mati di tengah kirim) dan dicoba lagi. */
const STALE_SENDING_MS = 10 * 60_000;

/**
 * Memasukkan email ke antrean. Hanya menulis ke database (cepat dan tidak gagal karena SMTP); pengiriman dilakukan pekerja latar.
 * Tidak melempar: gagal mencatat email tidak boleh menggagalkan tindakan utama pengguna.
 */
export const enqueueMail = async <K extends MailKind>(db: Db, input: { to: string; kind: K; locale: Locale; data: MailData[K]; businessId?: string | null }): Promise<string | null> => {
  const to = input.to.trim();
  // Alamat jelas tidak sah atau terlalu panjang untuk kolom: jangan antre (dan jangan melempar).
  if (!to || to.length > 191 || !/^[^\s@]+@[^\s@]+$/.test(to)) return null;
  try {
    const mail = renderMail(input.kind, input.locale, input.data);
    const id = newId();
    await db.insert(mailQueue).values({ id, businessId: input.businessId ?? null, recipient: to, kind: input.kind, locale: input.locale, subject: mail.subject.slice(0, 255), text: mail.text, html: mail.html });
    return id;
  } catch (error) {
    logLine("error", "mail.enqueue_failed", { kind: input.kind, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

const affected = (res: unknown): number => (res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;

export interface ProcessResult {
  attempted: number;
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Mengirim email yang sudah jatuh tempo. Setiap pesan "diklaim" lebih dulu (queued -> sending lewat pembaruan bersyarat),
 * jadi dua pekerja yang berjalan bersamaan tidak mengirim pesan yang sama dua kali.
 */
export const processMailQueue = async (db: Db, transport: MailTransport, now = new Date(), batch = 20): Promise<ProcessResult> => {
  const result: ProcessResult = { attempted: 0, sent: 0, retried: 0, failed: 0 };
  const stale = new Date(now.getTime() - STALE_SENDING_MS);
  const due = await db
    .select()
    .from(mailQueue)
    .where(or(and(eq(mailQueue.status, "queued"), lte(mailQueue.nextAttemptAt, now)), and(eq(mailQueue.status, "sending"), lte(mailQueue.nextAttemptAt, stale))))
    .orderBy(asc(mailQueue.createdAt))
    .limit(batch);

  for (const row of due) {
    const claim = await db
      .update(mailQueue)
      .set({ status: "sending", nextAttemptAt: now })
      .where(and(eq(mailQueue.id, row.id), eq(mailQueue.status, row.status), eq(mailQueue.nextAttemptAt, row.nextAttemptAt)));
    if (affected(claim) === 0) continue; // sudah diambil pekerja lain
    result.attempted++;
    const attempts = row.attempts + 1;
    try {
      const outcome = await transport.send({ to: row.recipient, subject: row.subject, text: row.text, html: row.html });
      const status: MailStatus = outcome === "logged" ? "logged" : "sent";
      await db.update(mailQueue).set({ status, attempts, sentAt: now, lastError: null }).where(eq(mailQueue.id, row.id));
      result.sent++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 250);
      if (attempts >= MAX_ATTEMPTS) {
        await db.update(mailQueue).set({ status: "failed", attempts, lastError: message }).where(eq(mailQueue.id, row.id));
        result.failed++;
      } else {
        const delay = RETRY_DELAYS_MIN[attempts - 1]! * 60_000;
        await db.update(mailQueue).set({ status: "queued", attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + delay) }).where(eq(mailQueue.id, row.id));
        result.retried++;
      }
      logLine("warn", "mail.send_failed", { id: row.id, kind: row.kind, attempts, error: message });
    }
  }
  return result;
};

/** Mengulang email gagal: kembali ke antrean dengan hitungan percobaan nol. */
export const retryMail = async (db: Db, id: string): Promise<boolean> => {
  const res = await db.update(mailQueue).set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(and(eq(mailQueue.id, id), inArray(mailQueue.status, ["failed"])));
  return affected(res) > 0;
};

/** Menghapus email yang sudah selesai (terkirim, dicatat, atau gagal) dan lebih tua dari `days` hari; isinya memuat nama dan alamat email. */
export const purgeOldMail = async (db: Db, days = 90, now = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const res = await db.delete(mailQueue).where(and(inArray(mailQueue.status, ["sent", "logged", "failed"]), lt(mailQueue.createdAt, cutoff)));
  return affected(res);
};
