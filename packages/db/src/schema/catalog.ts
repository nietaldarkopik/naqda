import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { dt, idColumn, timestamps } from "./columns";
import { businesses, outlets } from "./core";
import { uuid } from "../uuid";

/** Kolom turunan: nama hanya unik di antara baris yang belum dihapus (doc 02, bagian 3.0). */
const activeNameCol = () =>
  varchar("active_name", { length: 191 }).generatedAlwaysAs(sql`(IF(\`deleted_at\` IS NULL, \`name\`, NULL))`, {
    mode: "stored",
  });

const businessRef = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id);

/** Uang: integer satuan terkecil mata uang. Persen: basis point (10% = 1000). */
const money = (name: string) => bigint(name, { mode: "number" });

export const categories = mysqlTable(
  "categories",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("categories_name_uq").on(t.businessId, t.activeName)],
);

export const brands = mysqlTable(
  "brands",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("brands_name_uq").on(t.businessId, t.activeName)],
);

export const salesTypes = mysqlTable(
  "sales_types",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("sales_types_name_uq").on(t.businessId, t.activeName)],
);

export const taxes = mysqlTable(
  "taxes",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    rateBp: int("rate_bp").notNull(),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("taxes_name_uq").on(t.businessId, t.activeName)],
);

export const taxOutlets = mysqlTable(
  "tax_outlets",
  {
    taxId: uuid("tax_id").notNull().references(() => taxes.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taxId, t.outletId] })],
);

export const gratuities = mysqlTable(
  "gratuities",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    rateBp: int("rate_bp").notNull(),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("gratuities_name_uq").on(t.businessId, t.activeName)],
);

export const gratuityOutlets = mysqlTable(
  "gratuity_outlets",
  {
    gratuityId: uuid("gratuity_id").notNull().references(() => gratuities.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gratuityId, t.outletId] })],
);

export const salesTypeGratuities = mysqlTable(
  "sales_type_gratuities",
  {
    salesTypeId: uuid("sales_type_id").notNull().references(() => salesTypes.id, { onDelete: "cascade" }),
    gratuityId: uuid("gratuity_id").notNull().references(() => gratuities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.salesTypeId, t.gratuityId] })],
);

export const discounts = mysqlTable(
  "discounts",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    /** percent: value dalam basis point; amount: value dalam satuan terkecil mata uang. */
    kind: varchar("kind", { length: 16 }).$type<"percent" | "amount">().notNull(),
    value: money("value").notNull(),
    /** Bila true, nilai boleh diisi kasir saat transaksi (value menjadi bawaan). */
    customizable: boolean("customizable").notNull().default(false),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("discounts_name_uq").on(t.businessId, t.activeName)],
);

export const discountOutlets = mysqlTable(
  "discount_outlets",
  {
    discountId: uuid("discount_id").notNull().references(() => discounts.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.discountId, t.outletId] })],
);

export const items = mysqlTable(
  "items",
  {
    id: idColumn(),
    businessId: businessRef(),
    categoryId: uuid("category_id").references(() => categories.id),
    brandId: uuid("brand_id").references(() => brands.id),
    name: varchar("name", { length: 191 }).notNull(),
    description: varchar("description", { length: 1000 }),
    imageUrl: varchar("image_url", { length: 500 }),
    trackStock: boolean("track_stock").notNull().default(false),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("items_business_idx").on(t.businessId, t.name), index("items_category_idx").on(t.categoryId)],
);

export const itemVariants = mysqlTable(
  "item_variants",
  {
    id: idColumn(),
    businessId: businessRef(),
    itemId: uuid("item_id").notNull().references(() => items.id),
    name: varchar("name", { length: 191 }).notNull(),
    sku: varchar("sku", { length: 64 }),
    basePrice: money("base_price").notNull(),
    cost: money("cost").notNull().default(0),
    position: smallint("position", { unsigned: true }).notNull().default(0),
    ...timestamps,
    /** SKU unik per bisnis di antara varian yang belum dihapus. */
    activeSku: varchar("active_sku", { length: 64 }).generatedAlwaysAs(
      sql`(IF(\`deleted_at\` IS NULL, \`sku\`, NULL))`,
      { mode: "stored" },
    ),
  },
  (t) => [index("item_variants_item_idx").on(t.itemId), uniqueIndex("item_variants_sku_uq").on(t.businessId, t.activeSku)],
);

export const itemVariantPrices = mysqlTable(
  "item_variant_prices",
  {
    variantId: uuid("variant_id").notNull().references(() => itemVariants.id, { onDelete: "cascade" }),
    salesTypeId: uuid("sales_type_id").notNull().references(() => salesTypes.id, { onDelete: "cascade" }),
    price: money("price").notNull(),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.salesTypeId] })],
);

export const itemOutlets = mysqlTable(
  "item_outlets",
  {
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
    available: boolean("available").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.outletId] }), index("item_outlets_outlet_idx").on(t.outletId)],
);

export const modifierSets = mysqlTable(
  "modifier_sets",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    /** Batas pilihan; maxSelect null = bebas. */
    minSelect: tinyint("min_select", { unsigned: true }).notNull().default(0),
    maxSelect: tinyint("max_select", { unsigned: true }),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("modifier_sets_name_uq").on(t.businessId, t.activeName)],
);

export const modifierOptions = mysqlTable(
  "modifier_options",
  {
    id: idColumn(),
    businessId: businessRef(),
    setId: uuid("set_id").notNull().references(() => modifierSets.id),
    name: varchar("name", { length: 191 }).notNull(),
    price: money("price").notNull().default(0),
    position: smallint("position", { unsigned: true }).notNull().default(0),
    ...timestamps,
  },
  (t) => [index("modifier_options_set_idx").on(t.setId)],
);

export const itemModifierSets = mysqlTable(
  "item_modifier_sets",
  {
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    setId: uuid("set_id").notNull().references(() => modifierSets.id, { onDelete: "cascade" }),
    position: smallint("position", { unsigned: true }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.setId] })],
);

export const bundles = mysqlTable(
  "bundles",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    price: money("price").notNull(),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("bundles_name_uq").on(t.businessId, t.activeName)],
);

export const bundleItems = mysqlTable(
  "bundle_items",
  {
    bundleId: uuid("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => itemVariants.id),
    quantity: smallint("quantity", { unsigned: true }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.bundleId, t.variantId] })],
);

export const bundlePrices = mysqlTable(
  "bundle_prices",
  {
    bundleId: uuid("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
    salesTypeId: uuid("sales_type_id").notNull().references(() => salesTypes.id, { onDelete: "cascade" }),
    price: money("price").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bundleId, t.salesTypeId] })],
);

export const bundleOutlets = mysqlTable(
  "bundle_outlets",
  {
    bundleId: uuid("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.bundleId, t.outletId] })],
);

export const promos = mysqlTable(
  "promos",
  {
    id: idColumn(),
    businessId: businessRef(),
    name: varchar("name", { length: 191 }).notNull(),
    /** item_discount: potongan untuk item yang dibeli. free_item: beli X gratis Y. */
    type: varchar("type", { length: 24 }).$type<"item_discount" | "free_item">().notNull(),
    status: varchar("status", { length: 16 }).$type<"active" | "inactive">().notNull().default("active"),
    startsAt: dt("starts_at"),
    endsAt: dt("ends_at"),
    /** { from: "HH:mm", to: "HH:mm" } atau null (sepanjang hari). */
    hours: json("hours").$type<{ from: string; to: string } | null>(),
    /** Array hari 0 (Minggu) sampai 6 (Sabtu); null = setiap hari. */
    weekdays: json("weekdays").$type<number[] | null>(),
    /** Berlaku kelipatan (beli 4 gratis 2). */
    multiple: boolean("multiple").notNull().default(false),
    /** Syarat pembelian. */
    requirementScope: varchar("requirement_scope", { length: 16 }).$type<"item" | "category">().notNull(),
    requirementItemId: uuid("requirement_item_id").references(() => items.id),
    requirementCategoryId: uuid("requirement_category_id").references(() => categories.id),
    requirementQuantity: smallint("requirement_quantity", { unsigned: true }).notNull().default(1),
    /** Hadiah: potongan (percent bp / amount) atau item gratis. */
    rewardKind: varchar("reward_kind", { length: 16 }).$type<"percent" | "amount" | "free_item">().notNull(),
    rewardValue: money("reward_value").notNull().default(0),
    rewardItemId: uuid("reward_item_id").references(() => items.id),
    rewardQuantity: smallint("reward_quantity", { unsigned: true }).notNull().default(1),
    ...timestamps,
    activeName: activeNameCol(),
  },
  (t) => [uniqueIndex("promos_name_uq").on(t.businessId, t.activeName)],
);

export const promoOutlets = mysqlTable(
  "promo_outlets",
  {
    promoId: uuid("promo_id").notNull().references(() => promos.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.promoId, t.outletId] })],
);

export const promoSalesTypes = mysqlTable(
  "promo_sales_types",
  {
    promoId: uuid("promo_id").notNull().references(() => promos.id, { onDelete: "cascade" }),
    salesTypeId: uuid("sales_type_id").notNull().references(() => salesTypes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.promoId, t.salesTypeId] })],
);

/** Jejak perubahan data penting (harga, diskon, peran). Hanya ditambah, tidak pernah diubah. */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: idColumn(),
    businessId: businessRef(),
    userId: uuid("user_id"),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    action: varchar("action", { length: 24 }).notNull(),
    summary: varchar("summary", { length: 500 }),
    changes: json("changes").$type<Record<string, unknown> | null>(),
    createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("audit_business_time_idx").on(t.businessId, t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

/**
 * Terjemahan data bisnis (nama item, kategori, dst.) per bahasa. Nama dasar tetap di tabel aslinya;
 * bila terjemahan tidak ada, tampilkan nama dasar.
 */
export const translations = mysqlTable(
  "translations",
  {
    id: idColumn(),
    businessId: businessRef(),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    locale: varchar("locale", { length: 5 }).notNull(),
    field: varchar("field", { length: 32 }).notNull(),
    value: varchar("value", { length: 500 }).notNull(),
    updatedAt: dt("updated_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex("translations_uq").on(t.entityType, t.entityId, t.locale, t.field),
    index("translations_business_idx").on(t.businessId, t.entityType),
  ],
);
