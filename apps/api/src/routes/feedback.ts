import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { customers, feedback, orders, outlets, users, type DbHandle } from "@naqdi/db";
import { isLocalDate, addDays, localRangeUtc } from "@naqdi/domain";
import { AppError } from "../errors";
import { iso, requireAnyPrivilege, requirePrivilege, validate, type AppEnv } from "../http";
import { assignedOutlets } from "../repo/outlet-access";

/** Masukan pelanggan. Melihat: customers.manage atau reports.view; membalas: customers.manage. Terbatas pada outlet penugasan. */
export const feedbackRoutes = () => {
  const app = new Hono<AppEnv>();
  const view = requireAnyPrivilege("customers.manage", "reports.view");

  app.get(
    "/",
    view,
    validate("query", z.object({ outletId: z.string().uuid().optional(), rating: z.enum(["good", "bad"]).optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) })),
    async (c) => {
      const q = c.req.valid("query");
      const auth = c.get("auth");
      const db = c.get("db");
      const mine = await assignedOutlets(db, auth);
      if (q.outletId && !mine.some((o) => o.id === q.outletId)) throw new AppError("forbidden");
      const scoped = q.outletId ? mine.filter((o) => o.id === q.outletId) : mine;
      if (scoped.length === 0) return c.json({ items: [], total: 0, page: q.page, pageSize: q.pageSize, summary: { good: 0, bad: 0 } });
      if ((q.from && !isLocalDate(q.from)) || (q.to && !isLocalDate(q.to))) throw new AppError("validation", { fields: { from: "errors.validation" } });
      const tz = scoped[0]!.timezone;
      const range = q.from || q.to ? localRangeUtc(q.from ?? "1970-01-01", q.to ?? addDays(new Date().toISOString().slice(0, 10), 1), tz) : null;
      const base = and(eq(feedback.businessId, auth.businessId), inArray(feedback.outletId, scoped.map((o) => o.id)), range ? gte(feedback.createdAt, range.start) : undefined, range ? lt(feedback.createdAt, range.end) : undefined);
      const where = and(base, q.rating ? eq(feedback.rating, q.rating) : undefined);
      const rows = await db
        .select({ f: feedback, customer: customers.name, outlet: outlets.name, receipt: orders.receiptNumber })
        .from(feedback)
        .leftJoin(customers, eq(feedback.customerId, customers.id))
        .innerJoin(outlets, eq(feedback.outletId, outlets.id))
        .leftJoin(orders, eq(feedback.orderId, orders.id))
        .where(where)
        .orderBy(desc(feedback.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await db.select({ n: count() }).from(feedback).where(where);
      const [good] = await db.select({ n: count() }).from(feedback).where(and(base, eq(feedback.rating, "good")));
      const [bad] = await db.select({ n: count() }).from(feedback).where(and(base, eq(feedback.rating, "bad")));
      const repliers = new Map<string, string>();
      const ids = [...new Set(rows.flatMap((r) => (r.f.repliedBy ? [r.f.repliedBy] : [])))];
      if (ids.length) for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))) repliers.set(u.id, u.name);
      return c.json({
        items: rows.map(({ f, customer, outlet, receipt }) => ({ id: f.id, rating: f.rating, comment: f.comment, reply: f.reply, repliedBy: f.repliedBy ? (repliers.get(f.repliedBy) ?? null) : null, repliedAt: iso(f.repliedAt), customer, outlet, receipt, at: iso(f.createdAt) })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
        summary: { good: good?.n ?? 0, bad: bad?.n ?? 0 },
      });
    },
  );

  app.post("/:id/reply", requirePrivilege("customers.manage"), validate("param", z.object({ id: z.string().uuid() })), validate("json", z.object({ reply: z.string().trim().min(1).max(1000) })), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const mine = (await assignedOutlets(db, auth)).map((o) => o.id);
    const [row] = await db.select().from(feedback).where(and(eq(feedback.id, c.req.valid("param").id), eq(feedback.businessId, auth.businessId))).limit(1);
    if (!row || !mine.includes(row.outletId)) throw new AppError("not_found");
    await db.update(feedback).set({ reply: c.req.valid("json").reply, repliedBy: auth.userId, repliedAt: new Date() }).where(eq(feedback.id, row.id));
    return c.json({ ok: true });
  });

  return app;
};
