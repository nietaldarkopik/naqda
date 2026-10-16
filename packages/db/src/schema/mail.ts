import { sql } from "drizzle-orm";
import { index, int, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { dt, idColumn } from "./columns";
import { uuid } from "../uuid";

export type MailStatus = "queued" | "sending" | "sent" | "logged" | "failed";

/**
 * Antrean email transaksional (faktur, pembayaran, pendaftaran). Pesan dirender saat masuk antrean dan dikirim oleh pekerja
 * latar dengan percobaan ulang bertahap, sehingga gagal kirim tidak menggagalkan permintaan pengguna.
 * Status: queued (menunggu), sending (sedang dikirim), sent (terkirim lewat SMTP), logged (driver "log": hanya dicatat),
 * failed (menyerah setelah percobaan maksimum; bisa diulang pengelola).
 * `businessId` bukan kunci asing agar riwayat tetap ada bila bisnis dihapus. Isi `text`/`html` memuat data pribadi
 * (nama, email): ikut dibersihkan oleh kebijakan retensi.
 */
export const mailQueue = mysqlTable(
  "mail_queue",
  {
    id: idColumn(),
    businessId: uuid("business_id"),
    recipient: varchar("recipient", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    locale: varchar("locale", { length: 2 }).notNull().default("id"),
    subject: varchar("subject", { length: 255 }).notNull(),
    text: text("text").notNull(),
    html: text("html").notNull(),
    status: varchar("status", { length: 8 }).$type<MailStatus>().notNull().default("queued"),
    attempts: int("attempts").notNull().default(0),
    nextAttemptAt: dt("next_attempt_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    lastError: varchar("last_error", { length: 255 }),
    sentAt: dt("sent_at"),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("mail_queue_due_idx").on(t.status, t.nextAttemptAt), index("mail_queue_business_idx").on(t.businessId, t.createdAt)],
);
