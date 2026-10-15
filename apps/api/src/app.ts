import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { sql } from "drizzle-orm";
import type { DbHandle } from "@naqdi/db";
import type { Config } from "./config";
import { AppError, errorBody } from "./errors";
import { authenticate, requireBackoffice, type AppEnv } from "./http";
import { LoginLimiter } from "./auth/limiter";
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
import { posRoutes } from "./routes/pos-session";

export interface AppDeps {
  handle: DbHandle;
  config: Config;
  limiter?: LoginLimiter;
}

/** Membuat aplikasi Hono. Dipisah dari server agar bisa diuji tanpa membuka port. */
export const createApp = ({ handle, config, limiter = new LoginLimiter() }: AppDeps) => {
  const { db } = handle;
  const app = new Hono();

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
    console.error("[api] galat tidak tertangani:", err);
    return c.json(errorBody(c, new AppError("server")), 500);
  });
  app.notFound((c) => c.json(errorBody(c, new AppError("not_found")), 404));

  const v1 = new Hono();

  v1.get("/health", async (c) => {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", time: new Date().toISOString() });
  });

  const storage = localStorageDriver(config.storageDir);
  v1.route("/auth", authRoutes(db, config, limiter));
  v1.route("/files", fileRoutes(storage));
  v1.route("/pos", posRoutes(db, config, limiter));

  const secured = new Hono<AppEnv>();
  secured.use("*", authenticate(config.jwtSecret));
  secured.use("*", requireBackoffice);
  secured.use("*", async (c, next) => {
    c.set("repo", tenantRepo(db, c.get("auth").businessId));
    c.set("db", db);
    await next();
  });
  secured.route("/", meRoutes(db));
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
  v1.route("/", secured);

  app.route("/api/v1", v1);
  return app;
};
