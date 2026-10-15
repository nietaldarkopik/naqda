import { zValidator } from "@hono/zod-validator";
import { z, ZodDefault, type ZodObject, type ZodRawShape, type ZodType } from "zod";
import type { Context, MiddlewareHandler } from "hono";
import { hasBackofficeAccess, type Privilege } from "@naqdi/domain";
import { AppError } from "./errors";
import { verifyAccessToken, type AuthContext } from "./auth/tokens";
import type { DbHandle } from "@naqdi/db";
import type { TenantRepo } from "./repo/tenant";

export type AppEnv = {
  Variables: {
    auth: AuthContext;
    repo: TenantRepo;
    db: DbHandle["db"];
  };
};

/**
 * Skema PATCH: semua bidang opsional dan TANPA nilai bawaan.
 * `partial()` milik Zod tetap menerapkan `default()` saat bidang tidak dikirim, sehingga PATCH {name} akan
 * mengembalikan status, daftar outlet, mode pajak, dst. ke nilai bawaan dan menimpa data yang ada.
 */
export const patchSchema = <S extends ZodObject<ZodRawShape>>(schema: S): ReturnType<S["partial"]> => {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, field instanceof ZodDefault ? field.unwrap() : field]),
  ) as ZodRawShape;
  return z.object(shape).partial() as unknown as ReturnType<S["partial"]>;
};

/** Validasi dengan zod; hasilnya dipetakan ke galat `validation` berformat seragam. */
export const validate = <T extends ZodType>(target: "json" | "query" | "param", schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".") || "_";
        fields[key] ??= issue.code === "too_small" && issue.minimum === 1 ? "common.required" : issue.message;
      }
      throw new AppError("validation", { fields });
    }
  });

export const authenticate =
  (secret: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new AppError("unauthorized");
    const auth = await verifyAccessToken(token, secret);
    if (!auth) throw new AppError("unauthorized");
    c.set("auth", auth);
    await next();
  };

/** Endpoint Back Office: butuh akses back office dan (opsional) hak akses tertentu. */
export const requireBackoffice: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!hasBackofficeAccess(c.get("auth").accessType)) throw new AppError("no_backoffice_access");
  await next();
};

export const requirePrivilege =
  (...needed: Privilege[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const have = new Set(c.get("auth").privileges);
    if (!needed.every((p) => have.has(p))) throw new AppError("forbidden");
    await next();
  };

/** Cukup salah satu hak (mis. melihat stok boleh inventory.manage atau reports.view). */
export const requireAnyPrivilege =
  (...options: Privilege[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const have = new Set(c.get("auth").privileges);
    if (!options.some((p) => have.has(p))) throw new AppError("forbidden");
    await next();
  };

/**
 * Alamat klien dari X-Forwarded-For. Header ini mudah dipalsukan di bagian KIRI (diisi klien); proxy tepercaya menambahkan alamat
 * di KANAN. Karena itu yang dipakai adalah entri ke-`hops` dari kanan (jumlah proxy tepercaya), bukan entri pertama. hops 0 = abaikan header.
 */
export const clientIp = (c: Context, hops = 1): string => {
  if (hops <= 0) return "local";
  const list = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return c.req.header("x-real-ip") || "local";
  return list[Math.max(0, list.length - hops)] ?? "local";
};

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
