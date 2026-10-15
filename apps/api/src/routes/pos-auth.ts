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
import { privilegesOfRole, verifyPin } from "../pos/pin";
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

      const { user, role } = await verifyPin(db, { businessId: d.businessId, outletId: d.outletId }, userId, pin, { touchLogin: true });
      const privileges = await privilegesOfRole(db, role.id);
      const accessToken = await signPosToken(
        { userId, businessId: d.businessId, roleId: role.id, outletId: d.outletId, deviceId: d.id, privileges },
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
          name: user.name,
          locale: user.locale,
          role: { systemKey: role.systemKey, name: role.name, accessType: role.accessType },
          privileges,
        },
        outlet: outlet ? outletForPos(outlet) : null,
        business: business ? businessForPos(business) : null,
      });
    },
  );

  return app;
};
