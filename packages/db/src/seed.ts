import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { currencyInfo, systemRoles } from "@naqdi/domain";
import type { DbHandle } from "./client";
import {
  businesses, categories, discountOutlets, discounts, gratuities, gratuityOutlets, itemModifierSets, itemOutlets, items,
  itemVariantPrices, itemVariants, modifierOptions, modifierSets, outlets, rolePrivileges, roles, salesTypeGratuities,
  salesTypes, taxes, taxOutlets, userOutlets, users,
} from "./schema";
import { newId } from "./uuid";

type Db = DbHandle["db"];

export interface NewBusinessInput {
  name: string;
  currency?: string;
  currencyExponent?: number;
  defaultLocale?: "id" | "en" | "ar";
}

/** Membuat bisnis beserta lima peran bawaan (doc 01, bagian 2). Mengembalikan id peran per kunci. */
export const createBusinessWithRoles = async (db: Db, input: NewBusinessInput) => {
  // Jumlah desimal diturunkan dari kode ISO; kombinasi yang salah (mis. USD 0 desimal) ditolak karena menggeser semua angka.
  const info = currencyInfo(input.currency ?? "IDR");
  if (!info) throw new RangeError(`mata uang tidak didukung: ${input.currency}`);
  if (input.currencyExponent !== undefined && input.currencyExponent !== info.exponent) {
    throw new RangeError(`${info.code} memakai ${info.exponent} desimal, bukan ${input.currencyExponent}`);
  }
  const businessId = newId();
  await db.insert(businesses).values({
    id: businessId,
    name: input.name,
    currency: info.code,
    currencyExponent: info.exponent,
    defaultLocale: input.defaultLocale ?? "id",
  });

  const roleIds: Record<string, string> = {};
  for (const role of systemRoles) {
    const id = newId();
    roleIds[role.key] = id;
    await db.insert(roles).values({
      id,
      businessId,
      systemKey: role.key,
      accessType: role.accessType,
      isSystem: true,
    });
    await db.insert(rolePrivileges).values(role.privileges.map((privilege) => ({ roleId: id, privilege })));
  }

  // Sales type bawaan; pemilik bisnis bisa menambah (GoFood, GrabFood, dst.) di Library.
  const salesTypeIds: Record<string, string> = {};
  for (const name of ["Dine In", "Take Away"]) {
    const id = newId();
    salesTypeIds[name] = id;
    await db.insert(salesTypes).values({ id, businessId, name });
  }
  return { businessId, roleIds, salesTypeIds };
};

export const hashPassword = (plain: string, cost = 10): Promise<string> => bcrypt.hash(plain, cost);

export interface DemoSeedOptions {
  adminEmail?: string;
  adminPassword?: string;
  bcryptCost?: number;
}

export const demoDefaults = {
  adminEmail: "admin@naqdi.test",
  adminPassword: "Naqdi123!",
  cashierEmail: "kasir@naqdi.test",
  business: "Naqdi Demo",
} as const;

/** Data demo untuk fase 0: satu bisnis, dua outlet, dua pengguna. Aman dijalankan berulang. */
export const seedDemo = async (db: Db, options: DemoSeedOptions = {}) => {
  const email = options.adminEmail ?? demoDefaults.adminEmail;
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  if (existing.length > 0) return { created: false as const };

  const cost = options.bcryptCost ?? 10;
  const password = options.adminPassword ?? demoDefaults.adminPassword;
  const { businessId, roleIds, salesTypeIds } = await createBusinessWithRoles(db, { name: demoDefaults.business });

  const outletA = newId();
  const outletB = newId();
  await db.insert(outlets).values([
    { id: outletA, businessId, name: "Naqdi Demo - Pusat", address: "Jl. Contoh No. 1, Bandung", phone: "081200000001" },
    { id: outletB, businessId, name: "Naqdi Demo - Cabang 2", address: "Jl. Contoh No. 2, Jakarta", phone: "081200000002" },
  ]);

  const adminId = newId();
  const cashierId = newId();
  await db.insert(users).values([
    {
      id: adminId,
      businessId,
      name: "Admin Demo",
      email,
      roleId: roleIds.administrator!,
      passwordHash: await hashPassword(password, cost),
      locale: "id",
    },
    {
      id: cashierId,
      businessId,
      name: "Kasir Demo",
      email: demoDefaults.cashierEmail,
      roleId: roleIds.cashier!,
      passwordHash: await hashPassword(password, cost),
      locale: "id",
    },
  ]);
  await db.insert(userOutlets).values([
    { userId: adminId, outletId: outletA },
    { userId: adminId, outletId: outletB },
    { userId: cashierId, outletId: outletA },
  ]);
  await seedDemoCatalog(db, businessId, salesTypeIds, [outletA, outletB]);
  return { created: true as const, businessId, email, password };
};

/** Katalog contoh agar halaman Library tidak kosong saat dicoba. Harga dalam rupiah (tanpa desimal). */
const seedDemoCatalog = async (db: Db, businessId: string, salesTypeIds: Record<string, string>, outletIds: string[]) => {
  const dineIn = salesTypeIds["Dine In"]!;
  const takeAway = salesTypeIds["Take Away"]!;

  const catCoffee = newId();
  const catFood = newId();
  const catCold = newId();
  await db.insert(categories).values([
    { id: catCoffee, businessId, name: "Kopi" },
    { id: catFood, businessId, name: "Makanan" },
    { id: catCold, businessId, name: "Minuman Dingin" },
  ]);

  const tax = newId();
  await db.insert(taxes).values({ id: tax, businessId, name: "PB1 Restoran", rateBp: 1000 });
  await db.insert(taxOutlets).values(outletIds.map((outletId) => ({ taxId: tax, outletId })));

  const service = newId();
  await db.insert(gratuities).values({ id: service, businessId, name: "Service Charge", rateBp: 500 });
  await db.insert(gratuityOutlets).values(outletIds.map((outletId) => ({ gratuityId: service, outletId })));
  await db.insert(salesTypeGratuities).values({ salesTypeId: dineIn, gratuityId: service });

  const staff = newId();
  await db.insert(discounts).values({ id: staff, businessId, name: "Diskon Karyawan", kind: "percent", value: 2000, customizable: false });
  await db.insert(discountOutlets).values(outletIds.map((outletId) => ({ discountId: staff, outletId })));

  const topping = newId();
  await db.insert(modifierSets).values({ id: topping, businessId, name: "Topping", minSelect: 0, maxSelect: 2 });
  await db.insert(modifierOptions).values([
    { id: newId(), businessId, setId: topping, name: "Boba", price: 3000, position: 0 },
    { id: newId(), businessId, setId: topping, name: "Jelly", price: 2500, position: 1 },
    { id: newId(), businessId, setId: topping, name: "Extra Shot", price: 5000, position: 2 },
  ]);

  const demo: Array<{ name: string; cat: string; sets: boolean; variants: Array<{ name: string; sku: string; price: number; cost: number; takeAway?: number }> }> = [
    { name: "Kopi Susu", cat: catCoffee, sets: true, variants: [
      { name: "Reguler", sku: "KS-R", price: 20000, cost: 8000, takeAway: 22000 },
      { name: "Besar", sku: "KS-B", price: 25000, cost: 10000, takeAway: 27000 } ] },
    { name: "Americano", cat: catCoffee, sets: true, variants: [{ name: "Reguler", sku: "AM-R", price: 18000, cost: 6000 }] },
    { name: "Nasi Goreng", cat: catFood, sets: false, variants: [{ name: "Reguler", sku: "NG-R", price: 28000, cost: 12000 }] },
    { name: "Mie Goreng", cat: catFood, sets: false, variants: [{ name: "Reguler", sku: "MG-R", price: 26000, cost: 11000 }] },
    { name: "Es Teh Manis", cat: catCold, sets: true, variants: [
      { name: "Reguler", sku: "ET-R", price: 8000, cost: 2000 },
      { name: "Jumbo", sku: "ET-J", price: 12000, cost: 3500 } ] },
    { name: "Air Mineral", cat: catCold, sets: false, variants: [{ name: "Botol", sku: "AIR-1", price: 5000, cost: 2500 }] },
  ];
  for (const d of demo) {
    const itemId = newId();
    await db.insert(items).values({ id: itemId, businessId, categoryId: d.cat, name: d.name });
    for (const [position, v] of d.variants.entries()) {
      const variantId = newId();
      await db.insert(itemVariants).values({ id: variantId, businessId, itemId, name: v.name, sku: v.sku, basePrice: v.price, cost: v.cost, position });
      if (v.takeAway) await db.insert(itemVariantPrices).values({ variantId, salesTypeId: takeAway, price: v.takeAway });
    }
    if (d.sets) await db.insert(itemModifierSets).values({ itemId, setId: topping, position: 0 });
    await db.insert(itemOutlets).values(outletIds.map((outletId) => ({ itemId, outletId, available: true })));
  }
};
