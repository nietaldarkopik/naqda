import { compare } from "bcryptjs";
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { businesses, createBusiness, isValidTimezone, platformAdmins, platformAudit, users, type DbHandle } from "@naqdi/db";
import { TRIAL_DAYS, accessOf, billingIntervals, businessStatuses, isBusinessStatus, isPlanCode, isSupportedCurrency, limitsOf, trialEndFrom, type BusinessStatus } from "@naqdi/domain";
import { LoginLimiter } from "../auth/limiter";
import { signPlatformToken, verifyPlatformToken } from "../auth/tokens";
import { businessBilling, clearBillingCache, usageOf } from "../billing/access";
import type { Config } from "../config";
import { AppError } from "../errors";
import { clientIp, iso, validate } from "../http";
import { contains } from "../repo/generic";
import { recordPlatformEvent } from "../platform/audit";
import { businessStats } from "../platform/stats";

type Db = DbHandle["db"];
type PlatformEnv = { Variables: { admin: { id: string; email: string; name: string; role: "owner" | "support" } } };

const idParam = z.object({ id: z.string().uuid() });
// Hash palsu agar waktu respons tidak membedakan "email tidak ada" dari "kata sandi salah".
const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8o0C9Q9A8m2qf6y3n1p0cKQ1m9o5eC";
const TOKEN_TTL_SECONDS = 8 * 3600;

const dateField = z.string().datetime({ offset: true }).transform((v) => new Date(v));

const patchBody = z
  .object({
    plan: z.string().refine(isPlanCode, "plan tidak dikenal").optional(),
    /** null = hapus timpaan khusus (kembali ke batas paket). */
    limits: z.object({ maxOutlets: z.number().int().min(1).max(100_000), maxDevices: z.number().int().min(1).max(100_000), maxEmployees: z.number().int().min(1).max(100_000) }).partial().nullable().optional(),
    status: z.enum(businessStatuses).optional(),
    suspendReason: z.string().trim().max(255).optional(),
    trialEndsAt: dateField.nullable().optional(),
    extendTrialDays: z.number().int().min(1).max(365).optional(),
    currentPeriodEndsAt: dateField.nullable().optional(),
    billingInterval: z.enum(billingIntervals).nullable().optional(),
    /** Catatan pengelola; masuk jejak audit. */
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "note"), "tidak ada yang diubah");

const createBody = z.object({
  name: z.string().trim().min(2).max(120),
  currency: z.string().trim().toUpperCase().refine(isSupportedCurrency, "mata uang tidak didukung"),
  timezone: z.string().trim().max(64).refine(isValidTimezone, "zona waktu tidak dikenal"),
  locale: z.enum(["id", "en", "ar"]).default("id"),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  plan: z.string().refine(isPlanCode, "plan tidak dikenal").default("basic"),
  /** trial = uji coba `trialDays`; active = langsung aktif tanpa batas waktu (dikelola manual). */
  mode: z.enum(["trial", "active"]).default("trial"),
  trialDays: z.number().int().min(1).max(365).default(TRIAL_DAYS),
  adminEmail: z.string().trim().toLowerCase().email().max(191),
  adminName: z.string().trim().min(2).max(120).optional(),
  adminPassword: z.string().min(10).max(200).optional(),
});

/** Panel pengelola platform: akun dan token terpisah dari toko. Peran owner boleh mengubah; support hanya melihat. */
export const platformRoutes = (db: Db, config: Config) => {
  const app = new Hono<PlatformEnv>();
  const limiter = new LoginLimiter(5, 15 * 60_000);

  const present = async (rows: (typeof businesses.$inferSelect)[], withStats = true) => {
    const stats = withStats ? await businessStats(db, rows.map((r) => r.id)) : new Map();
    const now = new Date();
    return rows.map((b) => {
      const access = accessOf({ status: isBusinessStatus(b.status) ? b.status : "active", trialEndsAt: b.trialEndsAt, currentPeriodEndsAt: b.currentPeriodEndsAt }, now);
      const s = stats.get(b.id);
      return {
        id: b.id,
        name: b.name,
        country: b.country,
        currency: b.currency,
        locale: b.defaultLocale,
        plan: b.plan,
        status: b.status,
        access: { level: access.level, reason: access.reason, daysLeft: access.daysLeft, graceDaysLeft: access.graceDaysLeft },
        trialEndsAt: iso(b.trialEndsAt),
        currentPeriodEndsAt: iso(b.currentPeriodEndsAt),
        billingInterval: b.billingInterval,
        suspendedAt: iso(b.suspendedAt),
        suspendReason: b.suspendReason,
        termsAcceptedAt: iso(b.termsAcceptedAt),
        termsVersion: b.termsVersion,
        limits: limitsOf(b.plan, b.limits),
        limitsOverride: b.limits ?? null,
        createdAt: iso(b.createdAt),
        ...(s ? { owner: s.owner, usage: { outlets: s.outlets, devices: s.devices, employees: s.employees }, orders30d: s.orders30d, lastOrderAt: s.lastOrderAt } : {}),
      };
    });
  };

  // ------------------------------------------------------------------ masuk
  app.post("/auth/login", validate("json", z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) })), async (c) => {
    const { email, password } = c.req.valid("json");
    const key = `platform|${clientIp(c, config.trustProxyHops)}|${email}`;
    if (limiter.isBlocked(key)) throw new AppError("rate_limited");
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
    const ok = await compare(password, admin?.passwordHash ?? dummyHash);
    if (!admin || !ok || admin.status !== "active") {
      limiter.recordFailure(key);
      throw new AppError("unauthorized");
    }
    limiter.reset(key);
    await db.update(platformAdmins).set({ lastLoginAt: new Date() }).where(eq(platformAdmins.id, admin.id));
    const accessToken = await signPlatformToken({ adminId: admin.id, role: admin.role }, config.jwtSecret, TOKEN_TTL_SECONDS);
    return c.json({ accessToken, expiresIn: TOKEN_TTL_SECONDS, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  });

  // ------------------------------------------------------------------ semua yang lain butuh token pengelola
  app.use("*", async (c, next) => {
    if (c.req.path.endsWith("/auth/login")) return next();
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const ctx = token ? await verifyPlatformToken(token, config.jwtSecret) : null;
    if (!ctx) throw new AppError("unauthorized");
    // Peran dibaca dari database (bukan dari token) agar pengelola yang dinonaktifkan atau diturunkan perannya langsung berlaku.
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, ctx.adminId)).limit(1);
    if (!admin || admin.status !== "active") throw new AppError("unauthorized");
    c.set("admin", { id: admin.id, email: admin.email, name: admin.name, role: admin.role });
    await next();
  });
  const owner = async (c: { get: (k: "admin") => { role: string } }, next: () => Promise<void>) => {
    if (c.get("admin").role !== "owner") throw new AppError("forbidden");
    await next();
  };

  app.get("/me", (c) => c.json({ admin: c.get("admin") }));

  // ------------------------------------------------------------------ ringkasan
  app.get("/overview", async (c) => {
    const now = new Date();
    const rows = await db
      .select({ id: businesses.id, status: businesses.status, plan: businesses.plan, country: businesses.country, currency: businesses.currency, trialEndsAt: businesses.trialEndsAt, currentPeriodEndsAt: businesses.currentPeriodEndsAt, createdAt: businesses.createdAt, name: businesses.name })
      .from(businesses);
    const tally = <K extends string>(keyOf: (r: (typeof rows)[number]) => K | null) => {
      const m = new Map<K, number>();
      for (const r of rows) {
        const k = keyOf(r);
        if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
    };
    const levels = { full: 0, grace: 0, locked: 0 };
    const expiring: { id: string; name: string; endsAt: string; daysLeft: number }[] = [];
    for (const r of rows) {
      const a = accessOf({ status: isBusinessStatus(r.status) ? r.status : "active", trialEndsAt: r.trialEndsAt, currentPeriodEndsAt: r.currentPeriodEndsAt }, now);
      levels[a.level]++;
      if (r.status === "trial" && a.level === "full" && a.daysLeft !== null && a.daysLeft <= 3 && r.trialEndsAt) expiring.push({ id: r.id, name: r.name, endsAt: r.trialEndsAt.toISOString(), daysLeft: a.daysLeft });
    }
    const since = (days: number) => new Date(now.getTime() - days * 86_400_000);
    return c.json({
      total: rows.length,
      byStatus: tally((r) => r.status),
      byPlan: tally((r) => r.plan),
      byCountry: tally((r) => r.country ?? "?"),
      byCurrency: tally((r) => r.currency),
      access: levels,
      signups: { last7d: rows.filter((r) => r.createdAt >= since(7)).length, last30d: rows.filter((r) => r.createdAt >= since(30)).length },
      trialsExpiringSoon: expiring.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 20),
    });
  });

  // ------------------------------------------------------------------ bisnis
  app.get(
    "/businesses",
    validate(
      "query",
      z.object({
        q: z.string().trim().max(100).optional(),
        status: z.enum(businessStatuses).optional(),
        plan: z.string().optional(),
        expiringDays: z.coerce.number().int().min(1).max(60).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    ),
    async (c) => {
      const q = c.req.valid("query");
      const now = new Date();
      const where = and(
        q.status ? eq(businesses.status, q.status) : undefined,
        q.plan ? eq(businesses.plan, q.plan) : undefined,
        q.expiringDays ? and(eq(businesses.status, "trial"), gte(businesses.trialEndsAt, now), lte(businesses.trialEndsAt, new Date(now.getTime() + q.expiringDays * 86_400_000))) : undefined,
        q.q ? or(like(businesses.name, contains(q.q)), inArray(businesses.id, db.select({ id: users.businessId }).from(users).where(like(users.email, contains(q.q))))) : undefined,
      );
      const [{ n }] = (await db.select({ n: sql<number>`COUNT(*)` }).from(businesses).where(where)) as [{ n: number }];
      const rows = await db.select().from(businesses).where(where).orderBy(desc(businesses.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
      return c.json({ items: await present(rows), total: Number(n), page: q.page, pageSize: q.pageSize });
    },
  );

  app.get("/businesses/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const [row] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
    if (!row) throw new AppError("not_found");
    const [item] = await present([row]);
    const history = await db
      .select({ id: platformAudit.id, action: platformAudit.action, detail: platformAudit.detail, at: platformAudit.createdAt, admin: platformAdmins.name })
      .from(platformAudit)
      .leftJoin(platformAdmins, eq(platformAudit.adminId, platformAdmins.id))
      .where(eq(platformAudit.businessId, id))
      .orderBy(desc(platformAudit.createdAt))
      .limit(50);
    return c.json({ business: item, history: history.map((h) => ({ id: h.id, action: h.action, detail: h.detail, at: iso(h.at), admin: h.admin })) });
  });

  app.post("/businesses", owner, validate("json", createBody), async (c) => {
    const b = c.req.valid("json");
    const admin = c.get("admin");
    const now = new Date();
    try {
      const made = await createBusiness(db, {
        name: b.name,
        currency: b.currency,
        defaultLocale: b.locale,
        timezone: b.timezone,
        plan: b.plan,
        status: b.mode === "trial" ? "trial" : "active",
        trialEndsAt: b.mode === "trial" ? trialEndFrom(now, b.trialDays) : null,
        country: b.country ?? null,
        adminEmail: b.adminEmail,
        ...(b.adminName ? { adminName: b.adminName } : {}),
        ...(b.adminPassword ? { adminPassword: b.adminPassword } : {}),
        bcryptCost: config.bcryptCost,
      });
      await recordPlatformEvent(db, admin.id, "business.create", made.businessId, { name: b.name, plan: b.plan, mode: b.mode, currency: b.currency, adminEmail: made.email });
      const [row] = await db.select().from(businesses).where(eq(businesses.id, made.businessId)).limit(1);
      const [item] = await present([row!]);
      // Kata sandi acak dikembalikan SEKALI di sini dan tidak tersimpan polos.
      return c.json({ business: item, admin: { email: made.email, password: made.generatedPassword ? made.password : undefined } }, 201);
    } catch (e) {
      if (/Duplicate entry|ER_DUP_ENTRY/.test(e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "")) {
        throw new AppError("conflict", { fields: { adminEmail: "signup.emailTaken" } });
      }
      throw e;
    }
  });

  app.patch("/businesses/:id", owner, validate("param", idParam), validate("json", patchBody), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const admin = c.get("admin");
    const now = new Date();
    const [before] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
    if (!before) throw new AppError("not_found");

    const set: Partial<typeof businesses.$inferInsert> = {};
    const fieldError = (field: string, message: string): never => {
      throw new AppError("validation", { fields: { [field]: message } });
    };

    if (body.plan !== undefined) set.plan = body.plan;
    if (body.limits !== undefined) set.limits = body.limits === null ? null : (body.limits as Record<string, number>);
    if (body.billingInterval !== undefined) set.billingInterval = body.billingInterval;
    if (body.currentPeriodEndsAt !== undefined) set.currentPeriodEndsAt = body.currentPeriodEndsAt;
    if (body.trialEndsAt !== undefined) set.trialEndsAt = body.trialEndsAt;

    if (body.extendTrialDays !== undefined) {
      // Memperpanjang uji coba tidak boleh menurunkan pelanggan yang sudah membayar atau membuka akun yang ditangguhkan tanpa disengaja.
      if (before.status === "active" || before.status === "suspended") fieldError("extendTrialDays", "platform.extendNotAllowed");
      const base = before.trialEndsAt && before.trialEndsAt.getTime() > now.getTime() ? before.trialEndsAt : now;
      set.trialEndsAt = new Date(base.getTime() + body.extendTrialDays * 86_400_000);
      set.status = "trial";
    }
    if (body.status !== undefined) {
      const next: BusinessStatus = body.status;
      set.status = next;
      if (next === "suspended") {
        if (!body.suspendReason || body.suspendReason.length < 3) fieldError("suspendReason", "common.required");
        set.suspendedAt = now;
        set.suspendReason = body.suspendReason;
      } else {
        set.suspendedAt = null;
        set.suspendReason = null;
      }
    } else if (body.suspendReason !== undefined) {
      fieldError("suspendReason", "platform.reasonNeedsSuspend");
    }

    const changed: Record<string, { before: unknown; after: unknown }> = {};
    for (const [k, v] of Object.entries(set)) {
      const was = (before as Record<string, unknown>)[k];
      const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : (x ?? null));
      if (JSON.stringify(norm(was)) !== JSON.stringify(norm(v))) changed[k] = { before: norm(was), after: norm(v) };
    }

    await db.transaction(async (tx) => {
      if (Object.keys(set).length) await tx.update(businesses).set(set).where(eq(businesses.id, id));
      await recordPlatformEvent(tx as unknown as Db, admin.id, "business.update", id, { changed, ...(body.note ? { note: body.note } : {}) });
    });
    clearBillingCache(id); // berlaku segera di Back Office dan kasir bisnis itu
    const [row] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
    const [item] = await present([row!]);
    const billing = await businessBilling(db, id, 0);
    return c.json({ business: item, usage: await usageOf(db, id), effective: billing?.access ?? null });
  });

  // ------------------------------------------------------------------ jejak audit pengelola
  app.get(
    "/audit",
    validate("query", z.object({ businessId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) })),
    async (c) => {
      const q = c.req.valid("query");
      const where = q.businessId ? eq(platformAudit.businessId, q.businessId) : undefined;
      const rows = await db
        .select({ id: platformAudit.id, action: platformAudit.action, businessId: platformAudit.businessId, detail: platformAudit.detail, at: platformAudit.createdAt, admin: platformAdmins.name, business: businesses.name })
        .from(platformAudit)
        .leftJoin(platformAdmins, eq(platformAudit.adminId, platformAdmins.id))
        .leftJoin(businesses, eq(platformAudit.businessId, businesses.id))
        .where(where)
        .orderBy(desc(platformAudit.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return c.json({ items: rows.map((r) => ({ id: r.id, action: r.action, businessId: r.businessId, business: r.business, admin: r.admin, detail: r.detail, at: iso(r.at) })), page: q.page, pageSize: q.pageSize });
    },
  );

  return app;
};
