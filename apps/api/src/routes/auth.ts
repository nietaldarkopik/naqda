import { compare } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { refreshTokens, businesses, newId, type DbHandle } from "@naqdi/db";
import { hasBackofficeAccess, isPrivilege } from "@naqdi/domain";
import type { Config } from "../config";
import { AppError } from "../errors";
import { clientIp, validate } from "../http";
import { LoginLimiter } from "../auth/limiter";
import { hashRefreshToken, newRefreshToken, signAccessToken, type AuthContext } from "../auth/tokens";
import { authQueries } from "../repo/tenant";

const cookieName = "naqdi_rt";
const cookiePath = "/api/v1/auth";

// Hash palsu agar waktu respons tidak membedakan "email tidak ada" dari "kata sandi salah".
const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8o0C9Q9A8m2qf6y3n1p0cKQ1m9o5eC";

export const authRoutes = (db: DbHandle["db"], config: Config, limiter: LoginLimiter) => {
  const app = new Hono();
  const q = authQueries(db);

  const buildSession = async (userId: string) => {
    const row = await q.findUserForRefresh(userId);
    if (!row || row.user.status !== "active") return null;
    const privileges = (await q.privilegesOf(row.role.id)).filter(isPrivilege);
    const outlets = await q.outletsOf(row.user.id, row.user.businessId);
    const [business] = await db.select().from(businesses).where(eq(businesses.id, row.user.businessId)).limit(1);
    const auth: AuthContext = {
      userId: row.user.id,
      businessId: row.user.businessId,
      roleId: row.role.id,
      accessType: row.role.accessType,
      privileges,
    };
    return { row, auth, outlets, business };
  };

  const issueTokens = async (userId: string, userAgent: string | undefined) => {
    const session = await buildSession(userId);
    if (!session) throw new AppError("unauthorized");
    const accessToken = await signAccessToken(session.auth, config.jwtSecret, config.accessTtlSeconds);
    const refreshToken = newRefreshToken();
    await db.insert(refreshTokens).values({
      id: newId(),
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + config.refreshTtlSeconds * 1000),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });
    const { row, auth, outlets, business } = session;
    return {
      accessToken,
      refreshToken,
      body: {
        accessToken,
        expiresIn: config.accessTtlSeconds,
        user: {
          id: row.user.id,
          name: row.user.name,
          email: row.user.email,
          locale: row.user.locale,
          role: { id: row.role.id, systemKey: row.role.systemKey, name: row.role.name, accessType: row.role.accessType },
          privileges: auth.privileges,
          outlets,
        },
        business: business
          ? {
              id: business.id,
              name: business.name,
              currency: business.currency,
              currencyExponent: business.currencyExponent,
              defaultLocale: business.defaultLocale,
            }
          : null,
      },
    };
  };

  const respond = (c: import("hono").Context, issued: Awaited<ReturnType<typeof issueTokens>>) => {
    // Klien web: refresh token hanya lewat cookie httpOnly. Klien lain (desktop/mobile): lewat body.
    if (c.req.header("x-client") === "web") {
      setCookie(c, cookieName, issued.refreshToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.isProduction,
        path: cookiePath,
        maxAge: config.refreshTtlSeconds,
      });
      return c.json(issued.body);
    }
    return c.json({ ...issued.body, refreshToken: issued.refreshToken });
  };

  app.post(
    "/login",
    validate("json", z.object({ email: z.string().trim().min(1).max(191), password: z.string().min(1).max(200) })),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const key = `${clientIp(c)}|${email.toLowerCase()}`;
      if (limiter.isBlocked(key)) throw new AppError("rate_limited");

      const found = await q.findLoginUser(email);
      const ok = await compare(password, found?.user.passwordHash ?? dummyHash);
      if (!found || !ok || found.user.status !== "active") {
        limiter.recordFailure(key);
        throw new AppError("unauthorized", { messageKey: "auth.invalid" });
      }
      if (!hasBackofficeAccess(found.role.accessType)) throw new AppError("no_backoffice_access");

      limiter.reset(key);
      await q.touchLogin(found.user.id);
      return respond(c, await issueTokens(found.user.id, c.req.header("user-agent")));
    },
  );

  app.post("/refresh", validate("json", z.object({ refreshToken: z.string().min(10).optional() }).default({})), async (c) => {
    const body = c.req.valid("json");
    const presented = body.refreshToken ?? getCookie(c, cookieName);
    if (!presented) throw new AppError("unauthorized");

    const hash = hashRefreshToken(presented);
    const [stored] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
    if (!stored) throw new AppError("unauthorized");

    if (stored.revokedAt) {
      // Token lama dipakai ulang: kemungkinan dicuri. Cabut semua sesi pengguna ini.
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, stored.userId), isNull(refreshTokens.revokedAt)));
      throw new AppError("unauthorized");
    }
    if (stored.expiresAt.getTime() < Date.now()) throw new AppError("unauthorized");

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));
    const session = await buildSession(stored.userId);
    if (!session || !hasBackofficeAccess(session.auth.accessType)) throw new AppError("unauthorized");
    return respond(c, await issueTokens(stored.userId, c.req.header("user-agent")));
  });

  app.post("/logout", validate("json", z.object({ refreshToken: z.string().optional() }).default({})), async (c) => {
    const presented = c.req.valid("json").refreshToken ?? getCookie(c, cookieName);
    if (presented) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.tokenHash, hashRefreshToken(presented)), isNull(refreshTokens.revokedAt)));
    }
    deleteCookie(c, cookieName, { path: cookiePath });
    return c.body(null, 204);
  });

  return app;
};
