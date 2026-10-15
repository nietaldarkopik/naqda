import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { Hono } from "hono";
import { z } from "zod";
import { orderActivities, orders, users } from "@naqdi/db";
import { iso, requirePrivilege, validate, type AppEnv } from "../http";

const query = z.object({
  outletId: z.string().uuid().optional(),
  kind: z.string().max(24).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Penampil aktivitas kasir (hanya baca). Hak: reports.view. */
export const activityRoutes = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("reports.view"));
  app.get("/", validate("query", query), async (c) => {
    const q = c.req.valid("query");
    const db = c.get("db");
    const approver = alias(users, "approver");
    const where = and(
      eq(orderActivities.businessId, c.get("auth").businessId),
      q.outletId ? eq(orderActivities.outletId, q.outletId) : undefined,
      q.kind ? eq(orderActivities.kind, q.kind) : undefined,
    );
    const rows = await db
      .select({ a: orderActivities, user: users.name, approver: approver.name, receipt: orders.receiptNumber })
      .from(orderActivities)
      .innerJoin(users, eq(orderActivities.userId, users.id))
      .leftJoin(approver, eq(orderActivities.approvedBy, approver.id))
      .leftJoin(orders, eq(orderActivities.orderId, orders.id))
      .where(where)
      .orderBy(desc(orderActivities.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await db.select({ n: sql<string>`COUNT(*)` }).from(orderActivities).where(where);
    return c.json({
      items: rows.map((r) => ({
        id: r.a.id,
        kind: r.a.kind,
        orderId: r.a.orderId,
        receiptNumber: r.receipt,
        user: r.user,
        approvedBy: r.approver,
        detail: r.a.detail,
        at: iso(r.a.createdAt),
      })),
      total: Number(total?.n ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    });
  });
  return app;
};
