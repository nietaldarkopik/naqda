import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { devices, roles, users, type DbHandle } from "@naqdi/db";
import { hasAppAccess, isPrivilege, type Privilege } from "@naqdi/domain";
import { authQueries } from "../repo/tenant";
import type { PosAuthContext } from "../auth/tokens";
import { verifyPosToken } from "../auth/tokens";
import type { Config } from "../config";
import { AppError } from "../errors";

type Db = DbHandle["db"];

export interface DeviceInfo {
  id: string;
  businessId: string;
  outletId: string;
  name: string;
}

export type PosEnv = {
  Variables: {
    db: Db;
    device: DeviceInfo;
    pos: PosAuthContext;
  };
};

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Membuang pemisah dan huruf kecil agar "abcd-efgh" dan "ABCDEFGH" dianggap sama. */
export const normalizeCode = (code: string): string => code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Perangkat dikenali dari header X-Device-Token; perangkat yang dicabut ditolak. */
export const requireDevice =
  (db: Db): MiddlewareHandler<PosEnv> =>
  async (c, next) => {
    const token = c.req.header("x-device-token") ?? "";
    if (!token) throw new AppError("unauthorized", { messageKey: "pos.deviceInvalid" });
    const [row] = await db.select().from(devices).where(eq(devices.tokenHash, sha256(token))).limit(1);
    if (!row || row.revokedAt) throw new AppError("unauthorized", { messageKey: "pos.deviceInvalid" });
    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.id));
    }
    c.set("db", db);
    c.set("device", { id: row.id, businessId: row.businessId, outletId: row.outletId, name: row.name });
    await next();
  };

/**
 * Sesi kasir: token POS yang cocok dengan perangkat ini, dan penggunanya masih aktif.
 * Wajib dipasang SETELAH requireDevice. Token Back Office tidak diterima di sini.
 */
export const requirePos =
  (db: Db, config: Config): MiddlewareHandler<PosEnv> =>
  async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new AppError("unauthorized");
    const ctx = await verifyPosToken(token, config.jwtSecret);
    const device = c.get("device");
    if (!ctx || ctx.deviceId !== device.id || ctx.outletId !== device.outletId || ctx.businessId !== device.businessId) {
      throw new AppError("unauthorized");
    }
    const [user] = await db.select({ status: users.status, deletedAt: users.deletedAt, roleId: users.roleId }).from(users).where(eq(users.id, ctx.userId)).limit(1);
    if (!user || user.deletedAt || user.status !== "active") throw new AppError("unauthorized");
    // Hak diambil dari peran SAAT INI (bukan dari token berumur 12 jam): perubahan peran langsung berlaku di kasir.
    const [role] = await db.select({ accessType: roles.accessType }).from(roles).where(eq(roles.id, user.roleId)).limit(1);
    if (!role || !hasAppAccess(role.accessType)) throw new AppError("unauthorized");
    const current = (await authQueries(db).privilegesOf(user.roleId)).filter(isPrivilege);
    c.set("pos", { ...ctx, roleId: user.roleId, privileges: current });
    await next();
  };

export const requirePosPrivilege =
  (...needed: Privilege[]): MiddlewareHandler<PosEnv> =>
  async (c, next) => {
    const have = new Set(c.get("pos").privileges);
    if (!needed.every((p) => have.has(p))) throw new AppError("forbidden");
    await next();
  };
