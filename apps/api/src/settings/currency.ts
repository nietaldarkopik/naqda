import { and, eq } from "drizzle-orm";
import {
  bundles,
  discounts,
  ingredients,
  itemVariants,
  loyaltyRewards,
  modifierOptions,
  modifierSets,
  orders,
  promos,
  purchaseOrders,
  shifts,
  type DbHandle,
} from "@naqdi/db";

type Db = DbHandle["db"];

/**
 * Daftar jenis data bernilai uang yang sudah ada untuk bisnis ini. Semua uang disimpan sebagai bilangan bulat satuan
 * terkecil, jadi mengganti mata uang (apalagi dengan jumlah desimal berbeda) setelah ada data akan menggeser semua angka
 * (Rp 18.000 menjadi 180,00). Karena itu mata uang hanya boleh diganti selama daftar ini kosong.
 */
export const moneyDataKinds = async (db: Db, businessId: string): Promise<string[]> => {
  const has = async (rows: Promise<unknown[]>) => (await rows).length > 0;
  const checks: Array<[string, Promise<boolean>]> = [
    ["orders", has(db.select({ id: orders.id }).from(orders).where(eq(orders.businessId, businessId)).limit(1))],
    ["shifts", has(db.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, businessId)).limit(1))],
    ["items", has(db.select({ id: itemVariants.id }).from(itemVariants).where(eq(itemVariants.businessId, businessId)).limit(1))],
    ["bundles", has(db.select({ id: bundles.id }).from(bundles).where(eq(bundles.businessId, businessId)).limit(1))],
    [
      "modifiers",
      has(db.select({ id: modifierOptions.id }).from(modifierOptions).innerJoin(modifierSets, eq(modifierOptions.setId, modifierSets.id)).where(and(eq(modifierSets.businessId, businessId))).limit(1)),
    ],
    ["discounts", has(db.select({ id: discounts.id }).from(discounts).where(eq(discounts.businessId, businessId)).limit(1))],
    ["promos", has(db.select({ id: promos.id }).from(promos).where(eq(promos.businessId, businessId)).limit(1))],
    ["ingredients", has(db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.businessId, businessId)).limit(1))],
    ["purchaseOrders", has(db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.businessId, businessId)).limit(1))],
    ["rewards", has(db.select({ id: loyaltyRewards.id }).from(loyaltyRewards).where(eq(loyaltyRewards.businessId, businessId)).limit(1))],
  ];
  const found: string[] = [];
  for (const [name, promise] of checks) if (await promise) found.push(name);
  return found;
};
