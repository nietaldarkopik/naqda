import { sql } from "drizzle-orm";
import { bigint, boolean, index, int, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { dt, idColumn, timestamps } from "./columns";
import { categories, items } from "./catalog";
import { businesses, outlets, users } from "./core";
import { uuid } from "../uuid";

const businessRef = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id);
const money = (name: string) => bigint(name, { mode: "number" });

/** Pelanggan. Member loyalty = `memberSince` terisi. Saldo poin adalah cache dari buku besar `loyalty_ledger`. */
export const customers = mysqlTable(
  "customers",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 191 }),
    note: varchar("note", { length: 500 }),
    memberSince: dt("member_since"),
    /** Bonus member baru hanya diberikan sekali per pelanggan. */
    bonusGranted: boolean("bonus_granted").notNull().default(false),
    points: money("points").notNull().default(0),
    lifetimeSpending: money("lifetime_spending").notNull().default(0),
    visits: int("visits", { unsigned: true }).notNull().default(0),
    /** Kapan pelanggan menyetujui datanya disimpan (null = belum tercatat; pelanggan lama sebelum fitur ini). */
    consentAt: dt("consent_at"),
    /** Kapan data pribadinya dihapus (anonimisasi). Barisnya tetap ada agar riwayat transaksi tidak rusak. */
    anonymizedAt: dt("anonymized_at"),
    ...timestamps,
    /** Nomor telepon dan email unik per bisnis di antara pelanggan yang belum dihapus. */
    activePhone: varchar("active_phone", { length: 32 }).generatedAlwaysAs(sql`(IF(\`deleted_at\` IS NULL, \`phone\`, NULL))`, { mode: "stored" }),
    activeEmail: varchar("active_email", { length: 191 }).generatedAlwaysAs(sql`(IF(\`deleted_at\` IS NULL, \`email\`, NULL))`, { mode: "stored" }),
  },
  (t) => [
    uniqueIndex("customers_phone_uq").on(t.businessId, t.activePhone),
    uniqueIndex("customers_email_uq").on(t.businessId, t.activeEmail),
    index("customers_name_idx").on(t.businessId, t.name),
  ],
);

/** Satu program loyalty per bisnis. `pointMode`: spend = poin dari nilai belanja; item = poin per unit item/kategori. */
export const loyaltyPrograms = mysqlTable(
  "loyalty_programs",
  {
    id: idColumn(),
    businessId: businessRef(),
    enabled: boolean("enabled").notNull().default(false),
    pointMode: varchar("point_mode", { length: 8 }).$type<"spend" | "item">().notNull().default("spend"),
    /** Setiap kelipatan `spendAmount` (satuan terkecil) dari penjualan bersih memberi `spendPoints` poin. */
    spendAmount: money("spend_amount").notNull().default(10_000),
    spendPoints: int("spend_points", { unsigned: true }).notNull().default(1),
    bonusNewMember: int("bonus_new_member", { unsigned: true }).notNull().default(0),
    /** Batas jumlah member; null = tanpa batas. */
    memberQuota: int("member_quota", { unsigned: true }),
    /** Masa berlaku program (tanggal setempat YYYY-MM-DD); null = tanpa batas. */
    validFrom: varchar("valid_from", { length: 10 }),
    validTo: varchar("valid_to", { length: 10 }),
    /** Penukaran reward butuh kode validasi yang dikirim ke telepon pelanggan. */
    requireCode: boolean("require_code").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("loyalty_programs_business_uq").on(t.businessId)],
);

export const loyaltyEarnRules = mysqlTable(
  "loyalty_earn_rules",
  {
    id: idColumn(),
    businessId: businessRef(),
    itemId: uuid("item_id").references(() => items.id),
    categoryId: uuid("category_id").references(() => categories.id),
    pointsPerUnit: int("points_per_unit", { unsigned: true }).notNull(),
  },
  (t) => [index("loyalty_earn_rules_business_idx").on(t.businessId)],
);

export const loyaltyRewards = mysqlTable(
  "loyalty_rewards",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    pointsCost: int("points_cost", { unsigned: true }).notNull(),
    /** percent_total / amount_total: potongan total pesanan. item_discount: potongan untuk item atau kategori tertentu. */
    kind: varchar("kind", { length: 16 }).$type<"percent_total" | "amount_total" | "item_discount">().notNull(),
    /** Persen (basis point) atau nominal (satuan terkecil), sesuai `valueKind`. */
    valueKind: varchar("value_kind", { length: 8 }).$type<"percent" | "amount">().notNull(),
    value: money("value").notNull(),
    /** Batas potongan untuk jenis persen (satuan terkecil); null = tanpa batas. */
    maxDiscount: money("max_discount"),
    minPurchase: money("min_purchase").notNull().default(0),
    itemId: uuid("item_id").references(() => items.id),
    categoryId: uuid("category_id").references(() => categories.id),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("loyalty_rewards_business_idx").on(t.businessId)],
);

/** Buku besar poin: hanya menambah. Saldo = jumlah `points`. */
export const loyaltyLedger = mysqlTable(
  "loyalty_ledger",
  {
    id: idColumn(),
    businessId: businessRef(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    kind: varchar("kind", { length: 12 }).$type<"earn" | "redeem" | "bonus" | "adjust" | "reverse">().notNull(),
    points: money("points").notNull(),
    balanceAfter: money("balance_after").notNull(),
    orderId: uuid("order_id"),
    rewardId: uuid("reward_id").references(() => loyaltyRewards.id),
    note: varchar("note", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("loyalty_ledger_customer_idx").on(t.customerId, t.createdAt), index("loyalty_ledger_order_idx").on(t.orderId)],
);

/** Penukaran reward pada sebuah pesanan (satu baris per penukaran yang berhasil). */
export const loyaltyRedemptions = mysqlTable(
  "loyalty_redemptions",
  {
    id: idColumn(),
    businessId: businessRef(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    rewardId: uuid("reward_id").notNull().references(() => loyaltyRewards.id),
    orderId: uuid("order_id").notNull(),
    points: int("points", { unsigned: true }).notNull(),
    discount: money("discount").notNull().default(0),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("loyalty_redemptions_business_idx").on(t.businessId, t.createdAt), uniqueIndex("loyalty_redemptions_order_uq").on(t.orderId)],
);

/** Kode validasi penukaran reward: hanya hash yang disimpan, berlaku singkat dan sekali pakai. */
export const loyaltyCodes = mysqlTable(
  "loyalty_codes",
  {
    id: idColumn(),
    businessId: businessRef(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    rewardId: uuid("reward_id").notNull().references(() => loyaltyRewards.id),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: dt("expires_at").notNull(),
    usedAt: dt("used_at"),
    /** Salah memasukkan kode membatalkan kode itu setelah 5 kali. */
    attempts: int("attempts", { unsigned: true }).notNull().default(0),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("loyalty_codes_customer_idx").on(t.customerId, t.rewardId)],
);

/** Antrean pesan keluar (SMS). Belum ada penyedia SMS: pesan hanya dicatat dengan status "logged". */
export const smsOutbox = mysqlTable(
  "sms_outbox",
  {
    id: idColumn(),
    businessId: businessRef(),
    customerId: uuid("customer_id").references(() => customers.id),
    phone: varchar("phone", { length: 32 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    body: varchar("body", { length: 500 }).notNull(),
    status: varchar("status", { length: 12 }).$type<"logged" | "sent" | "failed">().notNull().default("logged"),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("sms_outbox_business_idx").on(t.businessId, t.createdAt)],
);

/** Masukan pelanggan (baik/buruk) yang dicatat kasir atau pelanggan, bisa dibalas dari Back Office. */
export const feedback = mysqlTable(
  "feedback",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    orderId: uuid("order_id"),
    customerId: uuid("customer_id").references(() => customers.id),
    rating: varchar("rating", { length: 4 }).$type<"good" | "bad">().notNull(),
    comment: varchar("comment", { length: 1000 }),
    reply: varchar("reply", { length: 1000 }),
    repliedBy: uuid("replied_by").references(() => users.id),
    repliedAt: dt("replied_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("feedback_business_idx").on(t.businessId, t.createdAt), index("feedback_outlet_idx").on(t.outletId, t.createdAt)],
);

