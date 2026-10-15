import { sql } from "drizzle-orm";
import { bigint, boolean, index, int, json, mysqlTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { dt, idColumn, timestamps } from "./columns";
import { itemVariants, modifierOptions } from "./catalog";
import { businesses, outlets, users } from "./core";
import { uuid } from "../uuid";

/**
 * Stok. Jumlah disimpan sebagai integer berskala 1000 (3 desimal: 2,5 kg = 2500). Biaya per satuan disimpan
 * berskala 1000 dalam satuan terkecil mata uang (Rp 12,5 per gram = 12500). Nilai (`value`) dalam satuan terkecil biasa.
 * Skala dan rumusnya ada di packages/domain/src/stock.ts.
 */

const businessRef = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id);
const big = (name: string) => bigint(name, { mode: "number" });
const activeNameCol = () =>
  varchar("active_name", { length: 191 }).generatedAlwaysAs(sql`(IF(\`deleted_at\` IS NULL, \`name\`, NULL))`, { mode: "stored" });

export type SubjectType = "variant" | "ingredient";
export type MovementKind =
  | "purchase"
  | "sale"
  | "refund"
  | "transfer_out"
  | "transfer_in"
  | "transfer_cancel"
  | "adjustment"
  | "production_out"
  | "production_in";

/** Bahan baku (raw) atau bahan setengah jadi (semi) yang diproduksi dari resep. */
export const ingredients = mysqlTable(
  "ingredients",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 8 }).$type<"raw" | "semi">().notNull().default("raw"),
    unit: varchar("unit", { length: 16 }).notNull(),
    category: varchar("category", { length: 120 }),
    trackStock: boolean("track_stock").notNull().default(true),
    /** Hasil satu kali produksi (bahan setengah jadi), berskala 1000. */
    yieldQty: big("yield_qty").notNull().default(1000),
    /** Biaya awal per satuan (berskala 1000) dipakai selama belum ada pembelian di outlet. */
    defaultCost: big("default_cost").notNull().default(0),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("ingredients_name_uq").on(t.businessId, t.activeName)],
);

/** Resep bahan setengah jadi: komponen dan jumlah per satu kali produksi. */
export const ingredientRecipeLines = mysqlTable(
  "ingredient_recipe_lines",
  {
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredients.id, { onDelete: "cascade" }),
    componentId: uuid("component_id").notNull().references(() => ingredients.id),
    quantity: big("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ingredientId, t.componentId] })],
);

/** Resep varian item: bahan yang dipakai untuk satu unit terjual. */
export const variantRecipeLines = mysqlTable(
  "variant_recipe_lines",
  {
    variantId: uuid("variant_id").notNull().references(() => itemVariants.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredients.id),
    quantity: big("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.ingredientId] }), index("variant_recipe_ingredient_idx").on(t.ingredientId)],
);

/** Stok modifier: bahan yang terpotong setiap kali opsi modifier dipilih (per unit item terjual). */
export const modifierOptionIngredients = mysqlTable(
  "modifier_option_ingredients",
  {
    optionId: uuid("option_id").notNull().references(() => modifierOptions.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredients.id),
    quantity: big("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.ingredientId] })],
);

/** Saldo stok per outlet dan objek (varian item atau bahan). `quantity` boleh negatif bila penjualan melebihi stok diizinkan. */
export const stockLevels = mysqlTable(
  "stock_levels",
  {
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    subjectType: varchar("subject_type", { length: 12 }).$type<SubjectType>().notNull(),
    subjectId: uuid("subject_id").notNull(),
    quantity: big("quantity").notNull().default(0),
    avgCost: big("avg_cost").notNull().default(0),
    /** Batas peringatan stok menipis (berskala 1000); 0 = tanpa peringatan. */
    alertLow: big("alert_low").notNull().default(0),
    updatedAt: dt("updated_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.subjectType, t.subjectId] }), index("stock_levels_subject_idx").on(t.subjectType, t.subjectId)],
);

/** Buku besar stok: hanya menambah. Saldo = jumlah `delta`. */
export const stockMovements = mysqlTable(
  "stock_movements",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    subjectType: varchar("subject_type", { length: 12 }).$type<SubjectType>().notNull(),
    subjectId: uuid("subject_id").notNull(),
    kind: varchar("kind", { length: 20 }).$type<MovementKind>().notNull(),
    delta: big("delta").notNull(),
    unitCost: big("unit_cost").notNull().default(0),
    /** delta x biaya, dalam satuan terkecil mata uang (negatif untuk keluar). */
    value: big("value").notNull().default(0),
    balanceAfter: big("balance_after").notNull().default(0),
    refType: varchar("ref_type", { length: 20 }),
    refId: uuid("ref_id"),
    orderItemId: uuid("order_item_id"),
    userId: uuid("user_id").references(() => users.id),
    note: varchar("note", { length: 255 }),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index("stock_movements_outlet_idx").on(t.outletId, t.createdAt),
    index("stock_movements_subject_idx").on(t.outletId, t.subjectType, t.subjectId, t.createdAt),
    index("stock_movements_ref_idx").on(t.refType, t.refId),
    index("stock_movements_order_item_idx").on(t.orderItemId),
  ],
);

export const suppliers = mysqlTable(
  "suppliers",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 191 }),
    address: varchar("address", { length: 500 }),
    city: varchar("city", { length: 120 }),
    postalCode: varchar("postal_code", { length: 16 }),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("suppliers_name_uq").on(t.businessId, t.activeName)],
);

export const purchaseOrders = mysqlTable(
  "purchase_orders",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    /** Nomor berurutan per outlet (tabel counters, kind "po"). */
    number: int("number", { unsigned: true }).notNull(),
    status: varchar("status", { length: 12 }).$type<"waiting" | "partial" | "completed" | "cancelled">().notNull().default("waiting"),
    note: varchar("note", { length: 500 }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    completedAt: dt("completed_at"),
  },
  (t) => [uniqueIndex("purchase_orders_number_uq").on(t.outletId, t.number), index("purchase_orders_status_idx").on(t.outletId, t.status)],
);

export const purchaseOrderLines = mysqlTable(
  "purchase_order_lines",
  {
    id: idColumn(),
    poId: uuid("po_id").notNull().references(() => purchaseOrders.id),
    subjectType: varchar("subject_type", { length: 12 }).$type<SubjectType>().notNull(),
    subjectId: uuid("subject_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    quantity: big("quantity").notNull(),
    unitCost: big("unit_cost").notNull(),
    receivedQty: big("received_qty").notNull().default(0),
  },
  (t) => [index("po_lines_po_idx").on(t.poId)],
);

export const transfers = mysqlTable(
  "transfers",
  {
    id: idColumn(),
    businessId: businessRef(),
    fromOutletId: uuid("from_outlet_id").notNull().references(() => outlets.id),
    toOutletId: uuid("to_outlet_id").notNull().references(() => outlets.id),
    number: int("number", { unsigned: true }).notNull(),
    status: varchar("status", { length: 12 }).$type<"in_transit" | "received" | "cancelled">().notNull().default("in_transit"),
    note: varchar("note", { length: 500 }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    receivedAt: dt("received_at"),
  },
  (t) => [uniqueIndex("transfers_number_uq").on(t.fromOutletId, t.number), index("transfers_to_idx").on(t.toOutletId, t.status)],
);

export const transferLines = mysqlTable(
  "transfer_lines",
  {
    id: idColumn(),
    transferId: uuid("transfer_id").notNull().references(() => transfers.id),
    subjectType: varchar("subject_type", { length: 12 }).$type<SubjectType>().notNull(),
    subjectId: uuid("subject_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    quantity: big("quantity").notNull(),
    /** Biaya per satuan saat dikirim (dari outlet asal); dipakai sebagai biaya masuk di outlet tujuan. */
    unitCost: big("unit_cost").notNull().default(0),
    receivedQty: big("received_qty").notNull().default(0),
  },
  (t) => [index("transfer_lines_transfer_idx").on(t.transferId)],
);

/** Penyesuaian / stok opname: hitungan aktual menggantikan saldo sistem. */
export const stockAdjustments = mysqlTable(
  "stock_adjustments",
  {
    id: idColumn(),
    businessId: businessRef(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    number: int("number", { unsigned: true }).notNull(),
    note: varchar("note", { length: 500 }),
    /** Jumlah nilai selisih (negatif = kerugian/biaya, positif = pendapatan). */
    valueChange: big("value_change").notNull().default(0),
    lines: json("lines").$type<{ subjectType: SubjectType; subjectId: string; name: string; expected: number; actual: number; delta: number; unitCost: number; value: number }[]>().notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex("stock_adjustments_number_uq").on(t.outletId, t.number), index("stock_adjustments_outlet_idx").on(t.outletId, t.createdAt)],
);
