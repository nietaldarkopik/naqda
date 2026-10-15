import { randomBytes } from "node:crypto";
import { isSupportedCurrency } from "@naqdi/domain";
import type { DbHandle } from "./client";
import { hashPassword, createBusinessWithRoles } from "./seed";
import { outlets, userOutlets, users } from "./schema";
import { newId } from "./uuid";

type Db = DbHandle["db"];

export interface CreateBusinessInput {
  name: string;
  /** Kode ISO 4217 yang didukung (IDR, USD, SGD, AUD, CAD, NZD, SAR, ...). Jumlah desimal diturunkan dari kode. */
  currency: string;
  defaultLocale?: "id" | "en" | "ar";
  outletName?: string;
  /** Zona waktu IANA outlet, mis. Asia/Jakarta, Asia/Riyadh, America/New_York. */
  timezone?: string;
  adminEmail: string;
  adminName?: string;
  /** Kosong = dibuat acak dan dikembalikan sekali. */
  adminPassword?: string;
  bcryptCost?: number;
}

export const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Membuat bisnis baru TANPA data demo: bisnis dengan mata uangnya, lima peran bawaan, tipe penjualan bawaan, satu outlet,
 * dan satu administrator. Dipakai CLI `npm run db:create-business`. Kata sandi acak dikembalikan sekali (tidak tersimpan polos).
 */
export const createBusiness = async (db: Db, input: CreateBusinessInput) => {
  if (!isSupportedCurrency(input.currency)) throw new RangeError(`mata uang tidak didukung: ${input.currency}`);
  const timezone = input.timezone ?? "Asia/Jakarta";
  if (!isValidTimezone(timezone)) throw new RangeError(`zona waktu tidak dikenal: ${timezone}`);
  const email = input.adminEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RangeError("email admin tidak valid");
  const password = input.adminPassword ?? randomBytes(12).toString("base64url");
  if (password.length < 8) throw new RangeError("kata sandi admin minimal 8 karakter");

  const { businessId, roleIds } = await createBusinessWithRoles(db, {
    name: input.name,
    currency: input.currency,
    defaultLocale: input.defaultLocale ?? "id",
  });
  const outletId = newId();
  await db.insert(outlets).values({ id: outletId, businessId, name: input.outletName ?? input.name, timezone });
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    businessId,
    name: input.adminName ?? "Administrator",
    email,
    roleId: roleIds.administrator!,
    passwordHash: await hashPassword(password, input.bcryptCost ?? 10),
  });
  await db.insert(userOutlets).values({ userId, outletId });
  return { businessId, outletId, userId, email, password, generatedPassword: input.adminPassword === undefined };
};
