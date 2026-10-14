import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { auditLogs, users } from "@naqdi/db";
import { iso, requirePrivilege, validate, type AppEnv } from "../http";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entityType: z.string().trim().max(40).optional(),
  action: z.enum(["create", "update", "delete", "import"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Penampil jejak audit (hanya baca). Hak: settings.manage. */
export const auditRoutes = () => {
  const app = new Hono<AppEnv>();

  app.get("/", requirePrivilege("settings.manage"), validate("query", query), async (c) => {
    const q = c.req.valid("query");
    const db = c.get("db");
    const where = and(
      eq(auditLogs.businessId, c.get("auth").businessId),
      q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
      q.action ? eq(auditLogs.action, q.action) : undefined,
      q.from ? gte(auditLogs.createdAt, q.from) : undefined,
      q.to ? lte(auditLogs.createdAt, q.to) : undefined,
    );
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(auditLogs).where(where);
    const rows = await db
      .select({ log: auditLogs, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return c.json({
      items: rows.map(({ log, userName }) => ({
        id: log.id,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        summary: log.summary,
        changes: log.changes,
        userName: userName ?? null,
        createdAt: iso(log.createdAt),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  return app;
};
