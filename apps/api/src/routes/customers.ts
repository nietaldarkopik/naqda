import { and, asc, count, desc, eq, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { customers, loyaltyLedger, loyaltyRedemptions, newId, type DbHandle } from "@naqdi/db";
import { localMoment, toCsv } from "@naqdi/domain";
import { translate } from "@naqdi/i18n";
import { AppError, duplicateKey, requestLocale } from "../errors";
import { iso, patchSchema, requireAnyPrivilege, requirePrivilege, validate, type AppEnv } from "../http";
import { addPoints, enrollCustomer, findCustomer } from "../loyalty/service";
import { writeAudit } from "../repo/audit";
import { contains } from "../repo/generic";
import { assignedOutlets } from "../repo/outlet-access";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });
const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const body = z.object({ name: z.string().trim().min(1).max(191), phone: optional(32), email: optional(191), note: optional(500) });

const present = (c: typeof customers.$inferSelect) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  note: c.note,
  member: Boolean(c.memberSince),
  memberSince: iso(c.memberSince),
  points: c.points,
  lifetimeSpending: c.lifetimeSpending,
  visits: c.visits,
  createdAt: iso(c.createdAt),
});

/** Pelanggan (Back Office). Menulis: customers.manage; melihat: customers.manage atau reports.view. */
export const customerRoutes = () => {
  const app = new Hono<AppEnv>();
  const view = requireAnyPrivilege("customers.manage", "reports.view");
  const manage = requirePrivilege("customers.manage");
  const dup = (e: unknown) => (duplicateKey(e) ? new AppError("conflict", { fields: { phone: "loyalty.duplicateCustomer" } }) : e);

  const todayFor = async (db: Db, auth: { userId: string; businessId: string }) => {
    const tz = (await assignedOutlets(db, auth))[0]?.timezone ?? "UTC";
    return localMoment(new Date(), tz).date;
  };

  const listWhere = (businessId: string, q?: string, member?: "yes" | "no") =>
    and(
      eq(customers.businessId, businessId),
      isNull(customers.deletedAt),
      member === "yes" ? isNotNull(customers.memberSince) : member === "no" ? isNull(customers.memberSince) : undefined,
      q ? or(like(customers.name, contains(q)), like(customers.phone, contains(q)), like(customers.email, contains(q))) : undefined,
    );

  app.get(
    "/",
    view,
    validate("query", z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().trim().max(100).optional(), member: z.enum(["yes", "no"]).optional() })),
    async (c) => {
      const { page, pageSize, q, member } = c.req.valid("query");
      const auth = c.get("auth");
      const db = c.get("db");
      const where = listWhere(auth.businessId, q, member);
      const rows = await db.select().from(customers).where(where).orderBy(asc(customers.name)).limit(pageSize).offset((page - 1) * pageSize);
      const [total] = await db.select({ n: count() }).from(customers).where(where);
      const [all] = await db.select({ n: count() }).from(customers).where(listWhere(auth.businessId));
      const [members] = await db.select({ n: count() }).from(customers).where(listWhere(auth.businessId, undefined, "yes"));
      const [redeemed] = await db.select({ n: count() }).from(loyaltyRedemptions).where(eq(loyaltyRedemptions.businessId, auth.businessId));
      return c.json({ items: rows.map(present), total: total?.n ?? 0, page, pageSize, summary: { customers: all?.n ?? 0, members: members?.n ?? 0, nonMembers: (all?.n ?? 0) - (members?.n ?? 0), redeemed: redeemed?.n ?? 0 } });
    },
  );

  // Dideklarasikan sebelum "/:id" agar "export" tidak dianggap id.
  app.get("/export", view, async (c) => {
    const auth = c.get("auth");
    const locale = requestLocale(c);
    const rows = await c.get("db").select().from(customers).where(listWhere(auth.businessId)).orderBy(asc(customers.name)).limit(50_000);
    const head = ["name", "phone", "email", "memberSince", "points", "lifetimeSpending", "visits"].map((k) => translate(locale, `customers.cols.${k}`));
    const csv = toCsv([head, ...rows.map((r) => [r.name, r.phone, r.email, r.memberSince ? r.memberSince.toISOString().slice(0, 10) : "", r.points, r.lifetimeSpending, r.visits])]);
    return new Response(`﻿${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="naqdi-customers.csv"' } });
  });

  app.get("/:id", view, validate("param", idParam), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const row = await findCustomer(db, auth.businessId, c.req.valid("param").id);
    if (!row) throw new AppError("not_found");
    const ledger = await db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, row.id)).orderBy(desc(loyaltyLedger.createdAt), desc(loyaltyLedger.id)).limit(50);
    return c.json({ ...present(row), ledger: ledger.map((l) => ({ id: l.id, kind: l.kind, points: l.points, balanceAfter: l.balanceAfter, note: l.note, orderId: l.orderId, at: iso(l.createdAt) })) });
  });

  app.post("/", manage, validate("json", body.extend({ enroll: z.boolean().default(false) })), async (c) => {
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const id = newId();
    try {
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        await tx.insert(customers).values({ id, businessId: auth.businessId, name: b.name, phone: b.phone, email: b.email, note: b.note });
        if (b.enroll) await enrollCustomer(tx, auth.businessId, id, await todayFor(db, auth), auth.userId);
        await writeAudit(tx, auth, { entityType: "customer", entityId: id, action: "create", summary: b.name, changes: { enroll: b.enroll } });
      });
    } catch (e) {
      throw dup(e);
    }
    return c.json(present((await findCustomer(db, auth.businessId, id))!), 201);
  });

  app.patch("/:id", manage, validate("param", idParam), validate("json", patchSchema(body)), async (c) => {
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const before = await findCustomer(db, auth.businessId, id);
    if (!before) throw new AppError("not_found");
    try {
      await db.transaction(async (tx) => {
        await tx.update(customers).set(b).where(eq(customers.id, id));
        await writeAudit(tx as unknown as Db, auth, { entityType: "customer", entityId: id, action: "update", summary: before.name, changes: { after: b } });
      });
    } catch (e) {
      throw dup(e);
    }
    return c.json(present((await findCustomer(db, auth.businessId, id))!));
  });

  app.delete("/:id", manage, validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const before = await findCustomer(db, auth.businessId, id);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "customer", entityId: id, action: "delete", summary: before.name });
    });
    return c.body(null, 204);
  });

  app.post("/:id/enroll", manage, validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const out = await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const r = await enrollCustomer(tx, auth.businessId, id, await todayFor(db, auth), auth.userId);
      await writeAudit(tx, auth, { entityType: "customer", entityId: id, action: "update", summary: r.name, changes: { enrolled: true } });
      return r;
    });
    return c.json(present(out));
  });

  // Berhenti menjadi member: poin tetap tersimpan tetapi tidak bertambah dan tidak bisa ditukar sampai terdaftar lagi.
  app.post("/:id/unenroll", manage, validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const before = await findCustomer(db, auth.businessId, id);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ memberSince: null }).where(eq(customers.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "customer", entityId: id, action: "update", summary: before.name, changes: { enrolled: false } });
    });
    return c.json(present((await findCustomer(db, auth.businessId, id))!));
  });

  // Penyesuaian poin manual (koreksi, kompensasi). Saldo tidak boleh menjadi negatif lewat jalur ini.
  app.post("/:id/points", manage, validate("param", idParam), validate("json", z.object({ points: z.number().int().refine((v) => v !== 0, "tidak boleh nol").refine((v) => Math.abs(v) <= 1_000_000_000), note: z.string().trim().min(1).max(255) })), async (c) => {
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const out = await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const cur = await findCustomer(tx, auth.businessId, id, true);
      if (!cur) throw new AppError("not_found");
      if (cur.points + b.points < 0) throw new AppError("validation", { fields: { points: "loyalty.negativeBalance" } });
      const next = await addPoints(tx, cur, "adjust", b.points, { note: b.note, userId: auth.userId });
      await writeAudit(tx, auth, { entityType: "customer", entityId: id, action: "update", summary: cur.name, changes: { points: b.points, note: b.note } });
      return next;
    });
    return c.json({ points: out.points });
  });

  void sql;
  return app;
};
