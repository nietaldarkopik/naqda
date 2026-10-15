import { sql } from "drizzle-orm";
import { index, json, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { dt, idColumn } from "./columns";
import { uuid } from "../uuid";

/**
 * Akun PENGELOLA platform (operator Naqdi), terpisah total dari pengguna toko (`users`). Tidak terikat ke bisnis mana pun.
 * Peran: owner (boleh mengubah) dan support (hanya melihat).
 */
export const platformAdmins = mysqlTable(
  "platform_admins",
  {
    id: idColumn(),
    email: varchar("email", { length: 191 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: varchar("password_hash", { length: 100 }).notNull(),
    role: varchar("role", { length: 8 }).$type<"owner" | "support">().notNull().default("support"),
    status: varchar("status", { length: 8 }).$type<"active" | "disabled">().notNull().default("active"),
    lastLoginAt: dt("last_login_at"),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex("platform_admins_email_uq").on(t.email)],
);

/**
 * Jejak tindakan pengelola dan peristiwa platform (mis. pendaftaran). Hanya menambah. `adminId` kosong = sistem (pendaftaran mandiri).
 * `businessId` sengaja BUKAN kunci asing agar jejaknya tetap ada bila bisnis nanti dihapus.
 */
export const platformAudit = mysqlTable(
  "platform_audit",
  {
    id: idColumn(),
    adminId: uuid("admin_id").references(() => platformAdmins.id),
    action: varchar("action", { length: 40 }).notNull(),
    businessId: uuid("business_id"),
    detail: json("detail").$type<Record<string, unknown> | null>(),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("platform_audit_time_idx").on(t.createdAt), index("platform_audit_business_idx").on(t.businessId, t.createdAt)],
);
