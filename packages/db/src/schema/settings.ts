import { sql } from "drizzle-orm";
import { boolean, index, int, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { dt, idColumn, timestamps } from "./columns";
import { businesses, users } from "./core";
import { uuid } from "../uuid";

/** Pengaturan akun per bisnis, satu baris: checkout, struk, notifikasi, dan akun. Bentuknya divalidasi di apps/api/src/settings. */
export const businessSettings = mysqlTable("business_settings", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id),
  checkout: json("checkout").$type<Record<string, unknown>>(),
  receipt: json("receipt").$type<Record<string, unknown>>(),
  notifications: json("notifications").$type<Record<string, unknown>>(),
  account: json("account").$type<Record<string, unknown>>(),
  updatedAt: dt("updated_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date()),
  updatedBy: uuid("updated_by").references(() => users.id),
});

/**
 * Metode pembayaran. Lima metode bawaan (cash, card, qris, ewallet, transfer) dibuat otomatis; metode kustom hanya non-tunai.
 * `cash` adalah satu-satunya metode tunai (kembalian) dan tidak bisa dimatikan.
 */
export const paymentMethods = mysqlTable(
  "payment_methods",
  {
    id: idColumn(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    key: varchar("key", { length: 24 }).notNull(),
    /** Nama kustom; kosong untuk metode bawaan (diterjemahkan lewat i18n). */
    name: varchar("name", { length: 80 }),
    isSystem: boolean("is_system").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    position: int("position", { unsigned: true }).notNull().default(0),
    /** Daftar id outlet yang boleh memakai metode ini; null = semua outlet. */
    outletIds: json("outlet_ids").$type<string[] | null>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("payment_methods_key_uq").on(t.businessId, t.key)],
);

/** Antrean email keluar. Belum ada penyedia email: pesan hanya dicatat dengan status "logged". */
export const emailOutbox = mysqlTable(
  "email_outbox",
  {
    id: idColumn(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    recipient: varchar("recipient", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 12 }).$type<"logged" | "sent" | "failed">().notNull().default("logged"),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("email_outbox_business_idx").on(t.businessId, t.createdAt)],
);
