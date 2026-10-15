import { sql } from "drizzle-orm";
import { bigint, boolean, index, int, json, mysqlTable, primaryKey, smallint, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { dt, idColumn, timestamps } from "./columns";
import { itemVariants, items, modifierOptions, salesTypes } from "./catalog";
import { businesses, outlets, users } from "./core";
import { customers, loyaltyRewards } from "./crm";
import { uuid } from "../uuid";

const businessRef = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id);

const money = (name: string) => bigint(name, { mode: "number" });

/** Perangkat kasir yang terdaftar di sebuah outlet. Diaktifkan sekali dengan kode sementara, lalu memakai token perangkat. */
export const devices = mysqlTable(
  "devices",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    name: varchar("name", { length: 120 }).notNull(),
    /** SHA-256 dari kode aktivasi sekali pakai (kode asli hanya ditampilkan sekali). */
    activationCodeHash: varchar("activation_code_hash", { length: 64 }),
    activationExpiresAt: dt("activation_expires_at"),
    /** SHA-256 dari token perangkat; token asli hanya dimiliki perangkat. */
    tokenHash: varchar("token_hash", { length: 64 }),
    activatedAt: dt("activated_at"),
    lastSeenAt: dt("last_seen_at"),
    revokedAt: dt("revoked_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index("devices_outlet_idx").on(t.outletId),
    uniqueIndex("devices_token_uq").on(t.tokenHash),
    uniqueIndex("devices_code_uq").on(t.activationCodeHash),
  ],
);

/** Penghitung berurutan per outlet (mis. nomor struk). Naik di dalam transaksi dengan kunci baris agar tanpa celah. */
export const counters = mysqlTable(
  "counters",
  {
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    kind: varchar("kind", { length: 24 }).notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.kind] })],
);

export const shifts = mysqlTable(
  "shifts",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    deviceId: uuid("device_id").references(() => devices.id),
    openedAt: dt("opened_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    closedAt: dt("closed_at"),
    openingCash: money("opening_cash").notNull().default(0),
    /** Diisi saat shift ditutup. */
    expectedCash: money("expected_cash"),
    actualCash: money("actual_cash"),
    difference: money("difference"),
    note: varchar("note", { length: 500 }),
    /** 1 selama shift terbuka, NULL setelah ditutup: dipakai agar satu kasir hanya punya satu shift terbuka per outlet. */
    openKey: tinyint("open_key").generatedAlwaysAs(sql`(IF(\`closed_at\` IS NULL, 1, NULL))`, { mode: "stored" }),
  },
  (t) => [
    index("shifts_outlet_idx").on(t.outletId, t.openedAt),
    uniqueIndex("shifts_one_open_uq").on(t.outletId, t.userId, t.openKey),
  ],
);

export const cashMovements = mysqlTable(
  "cash_movements",
  {
    id: idColumn(),
    businessId: businessRef(),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    kind: varchar("kind", { length: 8 }).$type<"in" | "out">().notNull(),
    amount: money("amount").notNull(),
    description: varchar("description", { length: 255 }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("cash_movements_shift_idx").on(t.shiftId)],
);

const activeNameCol = () =>
  varchar("active_name", { length: 120 }).generatedAlwaysAs(sql`(IF(\`deleted_at\` IS NULL, \`name\`, NULL))`, { mode: "stored" });

/** Area makan (mis. Indoor, Teras) per outlet. */
export const tableGroups = mysqlTable(
  "table_groups",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    name: varchar("name", { length: 120 }).notNull(),
    position: smallint("position", { unsigned: true }).notNull().default(0),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("table_groups_name_uq").on(t.outletId, t.activeName)],
);

/** Meja. x/y adalah posisi pada denah (satuan kotak, 0 = kiri/atas). */
export const tables = mysqlTable(
  "tables",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    groupId: uuid("group_id").references(() => tableGroups.id),
    name: varchar("name", { length: 120 }).notNull(),
    capacity: smallint("capacity", { unsigned: true }).notNull().default(2),
    x: smallint("x", { unsigned: true }).notNull().default(0),
    y: smallint("y", { unsigned: true }).notNull().default(0),
    shape: varchar("shape", { length: 8 }).$type<"rect" | "round">().notNull().default("rect"),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("tables_name_uq").on(t.outletId, t.activeName), index("tables_outlet_idx").on(t.outletId)],
);

export const orders = mysqlTable(
  "orders",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    /** Kasir yang membuat bill. */
    userId: uuid("user_id").notNull().references(() => users.id),
    deviceId: uuid("device_id").references(() => devices.id),
    salesTypeId: uuid("sales_type_id").notNull().references(() => salesTypes.id),
    /** Disiapkan untuk fase berikutnya (meja, pelanggan); belum ada tabelnya. */
    tableId: uuid("table_id").references(() => tables.id),
    customerId: uuid("customer_id").references(() => customers.id),
    /** Reward loyalty yang dipakai pada pesanan ini (poin dipotong saat dibayar). */
    rewardId: uuid("reward_id").references(() => loyaltyRewards.id),
    pointsEarned: int("points_earned", { unsigned: true }).notNull().default(0),
    pointsRedeemed: int("points_redeemed", { unsigned: true }).notNull().default(0),
    pax: smallint("pax", { unsigned: true }),
    label: varchar("label", { length: 80 }),
    note: varchar("note", { length: 500 }),
    status: varchar("status", { length: 8 }).$type<"open" | "paid" | "void">().notNull().default("open"),
    /** Nomor struk berurutan tanpa celah per outlet; baru diberikan saat lunas. */
    receiptNumber: int("receipt_number", { unsigned: true }),
    openedAt: dt("opened_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    paidAt: dt("paid_at"),
    voidedAt: dt("voided_at"),
    voidReason: varchar("void_reason", { length: 255 }),

    /** Diskon pesanan yang dipilih kasir: { kind: "percent"|"amount", value, discountId? }. */
    orderDiscount: json("order_discount").$type<{ kind: "percent" | "amount"; value: number; discountId?: string | null } | null>(),
    /** Pengaturan dan tarif yang berlaku saat dihitung, dibekukan agar struk dan laporan bisa direproduksi. */
    pricingSnapshot: json("pricing_snapshot").$type<Record<string, unknown> | null>(),

    subtotal: money("subtotal").notNull().default(0),
    discountTotal: money("discount_total").notNull().default(0),
    base: money("base").notNull().default(0),
    net: money("net").notNull().default(0),
    gratuity: money("gratuity").notNull().default(0),
    tax: money("tax").notNull().default(0),
    rounding: money("rounding").notNull().default(0),
    total: money("total").notNull().default(0),
    paidTotal: money("paid_total").notNull().default(0),
    changeGiven: money("change_given").notNull().default(0),
    /** Total yang sudah dikembalikan lewat refund (<= total). */
    refundedTotal: money("refunded_total").notNull().default(0),
  },
  (t) => [
    index("orders_outlet_status_idx").on(t.outletId, t.status, t.openedAt),
    index("orders_shift_idx").on(t.shiftId),
    index("orders_table_idx").on(t.tableId, t.status),
    uniqueIndex("orders_receipt_uq").on(t.outletId, t.receiptNumber),
  ],
);

export const orderItems = mysqlTable(
  "order_items",
  {
    id: idColumn(),
    businessId: businessRef(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    position: smallint("position", { unsigned: true }).notNull().default(0),
    /** Rujukan ke katalog; nama dan harga di bawah adalah SALINAN saat transaksi (katalog boleh berubah). */
    itemId: uuid("item_id").references(() => items.id),
    variantId: uuid("variant_id").references(() => itemVariants.id),
    bundleId: uuid("bundle_id"),
    categoryId: uuid("category_id"),
    name: varchar("name", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 64 }),
    /** Harga satuan termasuk modifier. */
    unitPrice: money("unit_price").notNull(),
    basePrice: money("base_price").notNull(),
    cost: money("cost").notNull().default(0),
    quantity: int("quantity", { unsigned: true }).notNull(),
    discount: json("discount").$type<{ kind: "percent" | "amount"; value: number; discountId?: string | null } | null>(),
    lineDiscount: money("line_discount").notNull().default(0),
    /** Bagian diskon pesanan yang dibebankan ke baris ini (dasar pembagian refund). */
    orderDiscountShare: money("order_discount_share").notNull().default(0),
    refundedQuantity: int("refunded_quantity", { unsigned: true }).notNull().default(0),
    /** Unit yang sudah dikembalikan ke stok lewat refund (<= refundedQuantity). */
    restockedQuantity: int("restocked_quantity", { unsigned: true }).notNull().default(0),
    promoDiscount: money("promo_discount").notNull().default(0),
    promoId: uuid("promo_id"),
    note: varchar("note", { length: 255 }),
    status: varchar("status", { length: 8 }).$type<"active" | "void">().notNull().default("active"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId, t.position)],
);

export const orderItemModifiers = mysqlTable(
  "order_item_modifiers",
  {
    id: idColumn(),
    orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id),
    optionId: uuid("option_id").references(() => modifierOptions.id),
    name: varchar("name", { length: 191 }).notNull(),
    price: money("price").notNull().default(0),
  },
  (t) => [index("order_item_modifiers_item_idx").on(t.orderItemId)],
);

export const payments = mysqlTable(
  "payments",
  {
    id: idColumn(),
    businessId: businessRef(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    method: varchar("method", { length: 24 }).notNull(),
    tendered: money("tendered").notNull(),
    /** Bagian yang benar-benar mengurangi tagihan (tunai: tendered - kembalian). */
    applied: money("applied").notNull(),
    change: money("change_amount").notNull().default(0),
    reference: varchar("reference", { length: 120 }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_shift_idx").on(t.shiftId)],
);

/** Antrean pengiriman struk (email/SMS). Pengiriman nyata belum ada; baris ini hanya mencatat permintaan. */
export const receiptOutbox = mysqlTable(
  "receipt_outbox",
  {
    id: idColumn(),
    businessId: businessRef(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    channel: varchar("channel", { length: 8 }).$type<"email" | "sms">().notNull(),
    destination: varchar("destination", { length: 191 }).notNull(),
    status: varchar("status", { length: 12 }).$type<"pending" | "sent" | "failed">().notNull().default("pending"),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("receipt_outbox_order_idx").on(t.orderId)],
);

export const refunds = mysqlTable(
  "refunds",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    /** Shift kasir yang mengeluarkan uang (refund tunai mengurangi laci shift ini). */
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    method: varchar("method", { length: 24 }).notNull(),
    total: money("total").notNull(),
    /** Barang dikembalikan ke stok saat refund. */
    restock: boolean("restock").notNull().default(false),
    /** Rincian refund (jumlah tiga kolom = total): bagian nilai barang, service, dan pajak dari total pesanan. */
    netAmount: money("net_amount").notNull().default(0),
    gratuityAmount: money("gratuity_amount").notNull().default(0),
    taxAmount: money("tax_amount").notNull().default(0),
    reason: varchar("reason", { length: 255 }).notNull(),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("refunds_order_idx").on(t.orderId), index("refunds_shift_idx").on(t.shiftId), index("refunds_outlet_idx").on(t.outletId, t.createdAt)],
);

export const refundItems = mysqlTable(
  "refund_items",
  {
    id: idColumn(),
    refundId: uuid("refund_id").notNull().references(() => refunds.id),
    orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id),
    quantity: int("quantity", { unsigned: true }).notNull(),
    amount: money("amount").notNull(),
  },
  (t) => [index("refund_items_refund_idx").on(t.refundId)],
);

/** Jejak aktivitas kasir (buat/ubah/batal bill, hapus item, refund, pindah meja, pisah bill). Hanya menambah. */
export const orderActivities = mysqlTable(
  "order_activities",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    orderId: uuid("order_id").references(() => orders.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    kind: varchar("kind", { length: 24 }).notNull(),
    detail: json("detail").$type<Record<string, unknown> | null>(),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("order_activities_outlet_idx").on(t.outletId, t.createdAt), index("order_activities_order_idx").on(t.orderId)],
);
