import { randomBytes } from "node:crypto";
import { compare } from "bcryptjs";
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { businesses, devices, outlets, roles, userOutlets, users, type DbHandle } from "@naqdi/db";
import { isPrivilege, lockoutSeconds } from "@naqdi/domain";
import type { LoginLimiter } from "../auth/limiter";
import { signPosToken } from "../auth/tokens";
import type { Config } from "../config";
import { AppError } from "../errors";
import { clientIp, validate } from "../http";
import { normalizeCode, requireDevice, sha256, type PosEnv } from "../pos/context";
import { authQueries } from "../repo/tenant";

type Db = DbHandle["db"];

// Hash palsu agar waktu respons tidak membedakan "pengguna tidak ada" dari "PIN salah".
const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8o0C9Q9A8m2qf6y3n1p0cKQ1m9o5eC";

type OutletRow = typeof outlets.$inferSelect;

export const outletForPos = (o: OutletRow) => ({
  id: o.id,
  name: o.name,
  timezone: o.timezone,
  settings: {
    pricesIncludeTax: o.pricesIncludeTax,
    pricesIncludeGratuity: o.pricesIncludeGratuity,
    taxOnGratuity: o.taxOnGratuity,
    roundingStep: o.roundingStep,
    roundingMode: o.roundingMode,
    discountMode: o.discountMode,
  },
});

export const businessForPos = (b: typeof businesses.$inferSelect) => ({
  id: b.id,
  name: b.name,
  currency: b.currency,
  currencyExponent: b.currencyExponent,
  defaultLocale: b.defaultLocale,
});

/** Aktivasi perangkat, daftar kasir, dan login PIN. Rute lain di bawah /pos butuh sesi kasir (lihat pos-session.ts). */
export const posAuthRoutes = (db: Db, config: Config, limiter: LoginLimiter) => {
  const app = new Hono<PosEnv>();
  const q = authQueries(db);

  app.post("/devices/activate", validate("json", z.object({ code: z.string().trim().min(4).max(32) })), async (c) => {
    const key = `activate|${clientIp(c)}`;
    if (limiter.isBlocked(key)) throw new AppError("rate_limited");
    const hash = sha256(normalizeCode(c.req.valid("json").code));

    const [found] = await db
      .select({ device: devices, outlet: outlets, business: businesses })
      .from(devices)
      .innerJoin(outlets, eq(devices.outletId, outlets.id))
      .innerJoin(businesses, eq(devices.businessId, businesses.id))
      .where(and(eq(devices.activationCodeHash, hash), isNull(devices.revokedAt), isNull(devices.activatedAt)))
      .limit(1);
    if (!found || !found.device.activationExpiresAt || found.device.activationExpiresAt.getTime() < Date.now() || found.outlet.deletedAt) {
      limiter.recordFailure(key);
      throw new AppError("unauthorized", { messageKey: "pos.codeInvalid" });
    }

    const deviceToken = randomBytes(32).toString("base64url");
    const [res] = await db
      .update(devices)
      .set({ tokenHash: sha256(deviceToken), activatedAt: new Date(), activationCodeHash: null, activationExpiresAt: null, lastSeenAt: new Date() })
      .where(and(eq(devices.id, found.device.id), isNull(devices.activatedAt), isNull(devices.revokedAt)));
    if (res.affectedRows !== 1) throw new AppError("unauthorized", { messageKey: "pos.codeInvalid" });

    limiter.reset(key);
    return c.json({
      deviceToken,
      device: { id: found.device.id, name: found.device.name },
      outlet: outletForPos(found.outlet),
      business: businessForPos(found.business),
    });
  });

  // Kasir yang bisa login di perangkat ini: ditugaskan ke outlet, aktif, punya PIN, dan perannya boleh memakai aplikasi.
  app.get("/users", requireDevice(db), async (c) => {
    const d = c.get("device");
    const rows = await db
      .select({ id: users.id, name: users.name, lockedUntil: users.pinLockedUntil, systemKey: roles.systemKey, roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(userOutlets, and(eq(userOutlets.userId, users.id), eq(userOutlets.outletId, d.outletId)))
      .where(
        and(
          eq(users.businessId, d.businessId),
          isNull(users.deletedAt),
          eq(users.status, "active"),
          isNotNull(users.pinHash),
          ne(roles.accessType, "backoffice_only"),
        ),
      )
      .orderBy(asc(users.name));
    const now = Date.now();
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: { systemKey: r.systemKey, name: r.roleName },
        locked: Boolean(r.lockedUntil && r.lockedUntil.getTime() > now),
      })),
    });
  });

  app.post(
    "/auth/pin",
    requireDevice(db),
    validate("json", z.object({ userId: z.string().uuid(), pin: z.string().min(1).max(32) })),
    async (c) => {
      const { userId, pin } = c.req.valid("json");
      const d = c.get("device");

      const [row] = await db
        .select({ user: users, role: roles })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .innerJoin(userOutlets, and(eq(userOutlets.userId, users.id), eq(userOutlets.outletId, d.outletId)))
        .where(and(eq(users.id, userId), eq(users.businessId, d.businessId), isNull(users.deletedAt), eq(users.status, "active"), ne(roles.accessType, "backoffice_only")))
        .limit(1);

      if (!row || !row.user.pinHash) {
        await compare(pin, dummyHash);
        throw new AppError("unauthorized", { messageKey: "pos.pinInvalid" });
      }

      const lockedUntil = row.user.pinLockedUntil;
      if (lockedUntil && lockedUntil.getTime() > Date.now()) {
        throw new AppError("locked", { extra: { retryAfterSeconds: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000) } });
      }

      if (!(await compare(pin, row.user.pinHash))) {
        // Penambahan atomik di SQL agar percobaan paralel tidak melewati batas.
        await db.update(users).set({ pinFailures: sql`${users.pinFailures} + 1` }).where(eq(users.id, userId));
        const [after] = await db.select({ failures: users.pinFailures }).from(users).where(eq(users.id, userId)).limit(1);
        const seconds = lockoutSeconds(after?.failures ?? 0);
        if (seconds > 0) {
          await db.update(users).set({ pinLockedUntil: new Date(Date.now() + seconds * 1000) }).where(eq(users.id, userId));
          throw new AppError("locked", { extra: { retryAfterSeconds: seconds } });
        }
        throw new AppError("unauthorized", { messageKey: "pos.pinInvalid" });
      }

      await db.update(users).set({ pinFailures: 0, pinLockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, userId));
      const privileges = (await q.privilegesOf(row.role.id)).filter(isPrivilege);
      const accessToken = await signPosToken(
        { userId, businessId: d.businessId, roleId: row.role.id, outletId: d.outletId, deviceId: d.id, privileges },
        config.jwtSecret,
        config.posTokenTtlSeconds,
      );
      const [outlet] = await db.select().from(outlets).where(eq(outlets.id, d.outletId)).limit(1);
      const [business] = await db.select().from(businesses).where(eq(businesses.id, d.businessId)).limit(1);
      return c.json({
        accessToken,
        expiresIn: config.posTokenTtlSeconds,
        user: {
          id: userId,
          name: row.user.name,
          locale: row.user.locale,
          role: { systemKey: row.role.systemKey, name: row.role.name, accessType: row.role.accessType },
          privileges,
        },
        outlet: outlet ? outletForPos(outlet) : null,
        business: business ? businessForPos(business) : null,
      });
    },
  );

  return app;
};
