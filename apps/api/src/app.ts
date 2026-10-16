import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { DbHandle } from "@naqdi/db";
import type { Config } from "./config";
import { AppError, errorBody } from "./errors";
import { logLine, requestLogger } from "./logging";
import { authenticate, requireBackoffice, type AppEnv } from "./http";
import { LoginLimiter } from "./auth/limiter";
import { enforceBackofficeAccess } from "./billing/access";
import { tenantRepo } from "./repo/tenant";
import { authRoutes } from "./routes/auth";
import { employeeRoutes } from "./routes/employees";
import { meRoutes } from "./routes/misc";
import { outletRoutes } from "./routes/outlets";
import { bundleRoutes } from "./routes/bundles";
import { brandRoutes, categoryRoutes, discountRoutes, gratuityRoutes, salesTypeRoutes, supplierRoutes, taxRoutes } from "./routes/catalog-simple";
import { itemRoutes } from "./routes/items";
import { modifierRoutes } from "./routes/modifiers";
import { promoRoutes } from "./routes/promos";
import { auditRoutes } from "./routes/audit";
import { fileRoutes, uploadRoutes } from "./routes/files";
import { translationRoutes } from "./routes/translations";
import { localStorageDriver } from "./storage";
import { deviceRoutes } from "./routes/devices";
import { tableRoutes } from "./routes/tables";
import { activityRoutes } from "./routes/activities";
import { reportRoutes } from "./routes/reports";
import { ingredientRoutes } from "./routes/ingredients";
import { inventoryRoutes } from "./routes/inventory";
import { customerRoutes } from "./routes/customers";
import { loyaltyRoutes } from "./routes/loyalty";
import { feedbackRoutes } from "./routes/feedback";
import { roleRoutes } from "./routes/roles";
import { settingsRoutes } from "./routes/settings";
import { posRoutes } from "./routes/pos-session";
import { platformRoutes } from "./routes/platform";
import { publicRoutes } from "./routes/public";
import { billingRoutes } from "./routes/billing";
import { createTransport, type MailTransport } from "./mail/transport";

const rootStatDir = process.cwd();

export interface AppDeps {
  handle: DbHandle;
  config: Config;
  limiter?: LoginLimiter;
  /** Pengirim email; bawaannya mengikuti config (SMTP bila SMTP_HOST diisi, kalau tidak hanya dicatat). Tes menyuntikkan pengirim memori. */
  transport?: MailTransport;
}

/** Membuat aplikasi Hono. Dipisah dari server agar bisa diuji tanpa membuka port. */
export const createApp = ({ handle, config, limiter = new LoginLimiter(), transport = createTransport(config) }: AppDeps) => {
  const { db } = handle;
  const app = new Hono();

  // Log akses JSON (dimatikan saat tes agar keluaran tes tetap bersih).
  app.use("*", requestLogger(config.nodeEnv !== "test"));
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => (config.corsOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["Authorization", "Content-Type", "X-Client", "X-Locale", "Accept-Language"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(c, err), err.status);
    logLine("error", "unhandled", { requestId: c.get("requestId" as never), path: new URL(c.req.url).pathname, error: err.message, stack: err.stack });
    return c.json(errorBody(c, new AppError("server")), 500);
  });
  app.notFound((c) => c.json(errorBody(c, new AppError("not_found")), 404));

  const v1 = new Hono();

  // Untuk pemantau (uptime monitor, load balancer): 200 sehat, 503 bila database tidak menjawab atau penyimpanan tidak bisa
  // ditulis. `diskFreePct` (volume folder unggahan) dipakai untuk peringatan dini sebelum disk penuh.
  v1.get("/health", async (c) => {
    const checks: Record<string, unknown> = {};
    const started = performance.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.db = "ok";
      checks.dbMs = Math.round(performance.now() - started);
    } catch {
      checks.db = "down";
    }
    try {
      const fsInfo = await statfs(config.storageDir).catch(() => statfs(rootStatDir));
      checks.diskFreePct = Math.round((Number(fsInfo.bavail) / Number(fsInfo.blocks)) * 1000) / 10;
    } catch {
      checks.diskFreePct = null;
    }
    const healthy = checks.db === "ok";
    return c.json({ status: healthy ? "ok" : "down", time: new Date().toISOString(), checks }, healthy ? 200 : 503);
  });

  const storage = localStorageDriver(config.storageDir);
  v1.route("/auth", authRoutes(db, config, limiter));
  v1.route("/files", fileRoutes(storage));
  v1.route("/pos", posRoutes(db, config, limiter));
  v1.route("/public", publicRoutes(db, config));
  v1.route("/platform", platformRoutes(db, config, transport));

  const secured = new Hono<AppEnv>();
  secured.use("*", authenticate(config.jwtSecret));
  secured.use("*", requireBackoffice);
  // Langganan tidak aktif: Back Office hanya-baca. Cache singkat di produksi; tes selalu membaca langsung.
  secured.use("*", enforceBackofficeAccess(db, config.nodeEnv === "test" ? 0 : 15_000));
  secured.use("*", async (c, next) => {
    c.set("repo", tenantRepo(db, c.get("auth").businessId));
    c.set("db", db);
    await next();
  });
  secured.route("/", meRoutes(db));
  secured.route("/billing", billingRoutes(db, config));
  secured.route("/outlets", outletRoutes());
  secured.route("/employees", employeeRoutes(config.bcryptCost));
  secured.route("/categories", categoryRoutes());
  secured.route("/brands", brandRoutes());
  secured.route("/sales-types", salesTypeRoutes());
  secured.route("/taxes", taxRoutes());
  secured.route("/gratuities", gratuityRoutes());
  secured.route("/discounts", discountRoutes());
  secured.route("/items", itemRoutes());
  secured.route("/modifiers", modifierRoutes());
  secured.route("/bundles", bundleRoutes());
  secured.route("/promos", promoRoutes());
  secured.route("/uploads", uploadRoutes(storage));
  secured.route("/translations", translationRoutes());
  secured.route("/audit", auditRoutes());
  secured.route("/devices", deviceRoutes());
  secured.route("/tables", tableRoutes());
  secured.route("/activities", activityRoutes());
  secured.route("/reports", reportRoutes());
  secured.route("/ingredients", ingredientRoutes());
  secured.route("/suppliers", supplierRoutes());
  secured.route("/inventory", inventoryRoutes());
  secured.route("/customers", customerRoutes());
  secured.route("/loyalty", loyaltyRoutes());
  secured.route("/feedback", feedbackRoutes());
  secured.route("/roles", roleRoutes());
  secured.route("/settings", settingsRoutes());
  v1.route("/", secured);

  app.route("/api/v1", v1);
  return app;
};
