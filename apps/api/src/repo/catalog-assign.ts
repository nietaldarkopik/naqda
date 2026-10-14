import { and, eq, isNull } from "drizzle-orm";
import {
  bundleOutlets,
  bundles,
  discountOutlets,
  discounts,
  gratuities,
  gratuityOutlets,
  itemOutlets,
  items,
  promoOutlets,
  promos,
  taxes,
  taxOutlets,
  type DbHandle,
} from "@naqdi/db";

type Db = DbHandle["db"];

const CHUNK = 500;

const insertChunks = async <T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) => {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
};

export interface AssignSummary {
  items: number;
  bundles: number;
  promos: number;
  taxes: number;
  gratuities: number;
  discounts: number;
}

/**
 * Menyediakan seluruh katalog bisnis (item, bundle, promo, pajak, gratuity, diskon) di outlet baru.
 * "Save to All Outlets" hanya berlaku saat disimpan; fungsi ini menutup celah untuk outlet yang dibuat kemudian.
 * Panggil di dalam transaksi yang sama dengan pembuatan outlet.
 */
export const assignCatalogToOutlet = async (db: Db, businessId: string, outletId: string): Promise<AssignSummary> => {
  const active = <T extends { businessId: unknown; deletedAt: unknown }>(t: T) => and(eq(t.businessId as never, businessId), isNull(t.deletedAt as never));

  const itemRows = await db.select({ id: items.id }).from(items).where(active(items));
  await insertChunks(itemRows, (c) => db.insert(itemOutlets).values(c.map((r) => ({ itemId: r.id, outletId, available: true }))));

  const bundleRows = await db.select({ id: bundles.id }).from(bundles).where(active(bundles));
  await insertChunks(bundleRows, (c) => db.insert(bundleOutlets).values(c.map((r) => ({ bundleId: r.id, outletId }))));

  const promoRows = await db.select({ id: promos.id }).from(promos).where(active(promos));
  await insertChunks(promoRows, (c) => db.insert(promoOutlets).values(c.map((r) => ({ promoId: r.id, outletId }))));

  const taxRows = await db.select({ id: taxes.id }).from(taxes).where(active(taxes));
  await insertChunks(taxRows, (c) => db.insert(taxOutlets).values(c.map((r) => ({ taxId: r.id, outletId }))));

  const gratuityRows = await db.select({ id: gratuities.id }).from(gratuities).where(active(gratuities));
  await insertChunks(gratuityRows, (c) => db.insert(gratuityOutlets).values(c.map((r) => ({ gratuityId: r.id, outletId }))));

  const discountRows = await db.select({ id: discounts.id }).from(discounts).where(active(discounts));
  await insertChunks(discountRows, (c) => db.insert(discountOutlets).values(c.map((r) => ({ discountId: r.id, outletId }))));

  return {
    items: itemRows.length,
    bundles: bundleRows.length,
    promos: promoRows.length,
    taxes: taxRows.length,
    gratuities: gratuityRows.length,
    discounts: discountRows.length,
  };
};
