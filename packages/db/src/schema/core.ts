import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { dt, idColumn, timestamps } from "./columns";
import { uuid } from "../uuid";

export const businesses = mysqlTable("businesses", {
  id: idColumn(),
  name: varchar("name", { length: 191 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 191 }),
  address: varchar("address", { length: 500 }),
  province: varchar("province", { length: 100 }),
  plan: varchar("plan", { length: 32 }).notNull().default("basic"),
  currency: varchar("currency", { length: 3 }).notNull().default("IDR"),
  currencyExponent: tinyint("currency_exponent", { unsigned: true }).notNull().default(0),
  defaultLocale: varchar("default_locale", { length: 5 }).notNull().default("id"),
  /** 0 = Minggu ... 6 = Sabtu */
  weekStart: tinyint("week_start", { unsigned: true }).notNull().default(1),
  settings: json("settings").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const outlets = mysqlTable(
  "outlets",
  {
    id: idColumn(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: varchar("name", { length: 191 }).notNull(),
    address: varchar("address", { length: 500 }),
    phone: varchar("phone", { length: 32 }),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Jakarta"),
    /**
     * Apakah harga jual di outlet ini sudah termasuk pajak. Berbeda tiap toko, jadi diatur per outlet.
     * true: pajak dipisahkan dari harga (harga menu = harga bayar). false: pajak ditambahkan di atas harga.
     */
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
    /** Harga menu sudah termasuk service charge/gratuity. */
    pricesIncludeGratuity: boolean("prices_include_gratuity").notNull().default(false),
    /** Pajak juga dikenakan atas service charge. */
    taxOnGratuity: boolean("tax_on_gratuity").notNull().default(true),
    /** Kelipatan pembulatan total dalam satuan terkecil; 0 = tanpa pembulatan (rupiah biasanya 100). */
    roundingStep: int("rounding_step", { unsigned: true }).notNull().default(0),
    roundingMode: varchar("rounding_mode", { length: 8 }).$type<"nearest" | "up" | "down">().notNull().default("nearest"),
    /** Cara beberapa diskon digabung: berurutan, kombinasi (stack), atau salah satu (exclusive). */
    /** Batas stok saat menjual: off = boleh minus, block = tolak, override = tolak kecuali kasir mengonfirmasi. */
    stockMode: varchar("stock_mode", { length: 10 }).$type<"off" | "block" | "override">().notNull().default("off"),
    discountMode: varchar("discount_mode", { length: 12 }).$type<"sequential" | "stack" | "exclusive">().notNull().default("sequential"),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    ...timestamps,
    /** Kolom turunan agar nama unik hanya di antara baris yang belum dihapus (doc 02, bagian 3.0). */
    activeName: varchar("active_name", { length: 191 }).generatedAlwaysAs(
      sql`(IF(\`deleted_at\` IS NULL, \`name\`, NULL))`,
      { mode: "stored" },
    ),
  },
  (t) => [
    index("outlets_business_idx").on(t.businessId),
    uniqueIndex("outlets_business_name_uq").on(t.businessId, t.activeName),
  ],
);

export const roles = mysqlTable(
  "roles",
  {
    id: idColumn(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    /** Nama kustom; untuk peran bawaan kosong dan nama diambil dari i18n lewat `systemKey`. */
    name: varchar("name", { length: 120 }),
    systemKey: varchar("system_key", { length: 32 }),
    accessType: varchar("access_type", { length: 24 })
      .$type<"app_only" | "backoffice_only" | "app_and_backoffice">()
      .notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("roles_business_idx").on(t.businessId)],
);

export const rolePrivileges = mysqlTable(
  "role_privileges",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    privilege: varchar("privilege", { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.privilege] })],
);

export const users = mysqlTable(
  "users",
  {
    id: idColumn(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: varchar("name", { length: 191 }).notNull(),
    email: varchar("email", { length: 191 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    pinHash: varchar("pin_hash", { length: 255 }),
    /** Kesalahan PIN beruntun dan batas kunci; direset saat PIN benar. */
    pinFailures: int("pin_failures", { unsigned: true }).notNull().default(0),
    pinLockedUntil: dt("pin_locked_until"),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    locale: varchar("locale", { length: 5 }),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive" | "invited">().notNull().default("active"),
    lastLoginAt: dt("last_login_at"),
    ...timestamps,
    /** Email unik secara global di antara akun yang belum dihapus (dipakai untuk login). */
    activeEmail: varchar("active_email", { length: 191 }).generatedAlwaysAs(
      sql`(IF(\`deleted_at\` IS NULL, LOWER(\`email\`), NULL))`,
      { mode: "stored" },
    ),
  },
  (t) => [
    index("users_business_idx").on(t.businessId),
    index("users_role_idx").on(t.roleId),
    uniqueIndex("users_active_email_uq").on(t.activeEmail),
  ],
);

export const userOutlets = mysqlTable(
  "user_outlets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.outletId] }), index("user_outlets_outlet_idx").on(t.outletId)],
);

export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hex dari token; token asli tidak pernah disimpan. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: dt("expires_at").notNull(),
    revokedAt: dt("revoked_at"),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash), index("refresh_tokens_user_idx").on(t.userId)],
);
