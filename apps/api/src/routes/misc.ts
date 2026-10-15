import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { businesses, type DbHandle } from "@naqdi/db";
import { AppError } from "../errors";
import type { AppEnv } from "../http";
import { authQueries } from "../repo/tenant";

/** Rute yang butuh pengguna masuk: profil dan daftar peran. */
export const meRoutes = (db: DbHandle["db"]) => {
  const app = new Hono<AppEnv>();
  const q = authQueries(db);

  app.get("/me", async (c) => {
    const { userId, businessId } = c.get("auth");
    const row = await q.findUserForRefresh(userId);
    if (!row || row.user.businessId !== businessId) throw new AppError("unauthorized");
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    return c.json({
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        locale: row.user.locale,
        role: { id: row.role.id, systemKey: row.role.systemKey, name: row.role.name, accessType: row.role.accessType },
        privileges: c.get("auth").privileges,
        outlets: await q.outletsOf(userId, businessId),
      },
      business: business && {
        id: business.id,
        name: business.name,
        currency: business.currency,
        currencyExponent: business.currencyExponent,
        defaultLocale: business.defaultLocale,
      },
    });
  });

  return app;
};
