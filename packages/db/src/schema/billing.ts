import { sql } from "drizzle-orm";
import { bigint, customType, index, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type { InvoiceStatus, PaymentProvider } from "@naqdi/domain";
import { dt, idColumn } from "./columns";
import { businesses } from "./core";
import { platformAdmins } from "./platform";
import { uuid } from "../uuid";

const mediumBlob = customType<{ data: Buffer }>({ dataType: () => "mediumblob" });

/**
 * Faktur langganan. `provider` menentukan cara bayar: manual_transfer (transfer bank + bukti, diverifikasi pengelola) sekarang,
 * google_play nanti. Faktur lunas MENAMBAH periode bisnis (lihat approve di platform). Jumlah dalam satuan terkecil mata uang.
 * Status: open (menunggu pembayaran), pending (bukti dikirim, menunggu verifikasi), paid, void.
 */
export const invoices = mysqlTable(
  "invoices",
  {
    id: idColumn(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    number: varchar("number", { length: 24 }).notNull(),
    plan: varchar("plan", { length: 20 }).notNull(),
    interval: varchar("interval", { length: 8 }).$type<"monthly" | "yearly">().notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 8 }).$type<InvoiceStatus>().notNull().default("open"),
    provider: varchar("provider", { length: 20 }).$type<PaymentProvider>().notNull().default("manual_transfer"),
    /** Rujukan di penyedia luar (mis. purchase token Google Play); kosong untuk transfer manual. */
    externalRef: varchar("external_ref", { length: 191 }),
    dueAt: dt("due_at"),
    paidAt: dt("paid_at"),
    reviewedBy: uuid("reviewed_by").references(() => platformAdmins.id),
    rejectReason: varchar("reject_reason", { length: 255 }),
    /** Dibuat pengelola dengan jumlah khusus (bukan dari daftar harga). */
    custom: bigint("custom", { mode: "number" }).notNull().default(0),
    note: varchar("note", { length: 255 }),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex("invoices_number_uq").on(t.number), index("invoices_business_idx").on(t.businessId, t.createdAt), index("invoices_status_idx").on(t.status, t.createdAt)],
);

/** Bukti transfer yang dikirim pelanggan. Satu faktur bisa punya beberapa (ditolak lalu dikirim ulang); gambar disimpan di database, tidak publik. */
export const invoiceProofs = mysqlTable(
  "invoice_proofs",
  {
    id: idColumn(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    bank: varchar("bank", { length: 80 }).notNull(),
    sender: varchar("sender", { length: 120 }).notNull(),
    transferredOn: varchar("transferred_on", { length: 10 }).notNull(),
    note: varchar("note", { length: 255 }),
    imageType: varchar("image_type", { length: 20 }),
    image: mediumBlob("image"),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("invoice_proofs_invoice_idx").on(t.invoiceId, t.createdAt)],
);
