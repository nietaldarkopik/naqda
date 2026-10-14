import { and, asc, count, eq, isNull, like, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { categories, items, newId, outlets, promoOutlets, promos, promoSalesTypes, salesTypes, type DbHandle } from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { activeOutletIds, contains, missingIn } from "../repo/generic";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });
const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:mm");

const body = z.object({
  name: z.string().trim().min(1).max(191),
  type: z.enum(["item_discount", "free_item"]),
  status: z.enum(["active", "inactive"]).default("active"),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  hours: z.object({ from: hhmm, to: hhmm }).nullish(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
  multiple: z.boolean().default(false),
  requirementScope: z.enum(["item", "category"]),
  requirementItemId: uuid.nullish(),
  requirementCategoryId: uuid.nullish(),
  requirementQuantity: z.number().int().min(1).max(999).default(1),
  rewardKind: z.enum(["percent", "amount", "free_item"]),
  rewardValue: z.number().int().min(0).max(9_000_000_000_000).default(0),
  rewardItemId: uuid.nullish(),
  rewardQuantity: z.number().int().min(1).max(999).default(1),
  outletIds: z.array(uuid).max(500).optional(),
  allOutlets: z.boolean().optional(),
  salesTypeIds: z.array(uuid).max(100).optional(),
});

type Input = z.infer<typeof body>;

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

/** Aturan lintas bidang pada data gabungan. Mengembalikan galat per bidang. */
export const promoRules = (d: Partial<Input>): Record<string, string> => {
  const f: Record<string, string> = {};
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) f.endsAt = "errors.validation";
  if (d.weekdays && new Set(d.weekdays).size !== d.weekdays.length) f.weekdays = "errors.validation";
  if (d.requirementScope === "item" && !d.requirementItemId) f.requirementItemId = "common.required";
  if (d.requirementScope === "category" && !d.requirementCategoryId) f.requirementCategoryId = "common.required";
  if (d.type === "item_discount") {
    if (d.rewardKind === "free_item") f.rewardKind = "errors.validation";
    if (d.rewardKind === "percent" && !((d.rewardValue ?? 0) >= 1 && (d.rewardValue ?? 0) <= 10_000)) f.rewardValue = "errors.validation";
    if (d.rewardKind === "amount" && !((d.rewardValue ?? 0) >= 1)) f.rewardValue = "errors.validation";
  }
  if (d.type === "free_item") {
    if (d.rewardKind !== "free_item") f.rewardKind = "errors.validation";
    if (!d.rewardItemId) f.rewardItemId = "common.required";
  }
  return f;
};

const load = async (db: Db, businessId: string, ids: string[]) => {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(promos)
    .where(and(eq(promos.businessId, businessId), isNull(promos.deletedAt), inArray(promos.id, ids)))
    .orderBy(asc(promos.name));
  const outs = await db.select().from(promoOutlets).where(inArray(promoOutlets.promoId, ids));
  const sts = await db.select().from(promoSalesTypes).where(inArray(promoSalesTypes.promoId, ids));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    startsAt: iso(p.startsAt),
    endsAt: iso(p.endsAt),
    hours: p.hours,
    weekdays: p.weekdays,
    multiple: p.multiple,
    requirementScope: p.requirementScope,
    requirementItemId: p.requirementItemId,
    requirementCategoryId: p.requirementCategoryId,
    requirementQuantity: p.requirementQuantity,
    rewardKind: p.rewardKind,
    rewardValue: p.rewardValue,
    rewardItemId: p.rewardItemId,
    rewardQuantity: p.rewardQuantity,
    outletIds: outs.filter((o) => o.promoId === p.id).map((o) => o.outletId),
    salesTypeIds: sts.filter((s) => s.promoId === p.id).map((s) => s.salesTypeId),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  }));
};

const checkRefs = async (db: Db, businessId: string, d: Partial<Input>) => {
  const f: Record<string, string> = {};
  if (d.requirementItemId && (await missingIn(db, items, businessId, [d.requirementItemId])).length) f.requirementItemId = "errors.notFound";
  if (d.rewardItemId && (await missingIn(db, items, businessId, [d.rewardItemId])).length) f.rewardItemId = "errors.notFound";
  if (d.requirementCategoryId && (await missingIn(db, categories, businessId, [d.requirementCategoryId])).length) f.requirementCategoryId = "errors.notFound";
  if (d.outletIds && (await missingIn(db, outlets, businessId, d.outletIds)).length) f.outletIds = "errors.notFound";
  if (d.salesTypeIds && (await missingIn(db, salesTypes, businessId, d.salesTypeIds)).length) f.salesTypeIds = "errors.notFound";
  if (Object.keys(f).length) throw new AppError("validation", { fields: f });
};

const COLUMNS = [
  "name", "type", "status", "startsAt", "endsAt", "hours", "weekdays", "multiple", "requirementScope", "requirementItemId",
  "requirementCategoryId", "requirementQuantity", "rewardKind", "rewardValue", "rewardItemId", "rewardQuantity",
] as const;

const writeLinks = async (db: Db, businessId: string, id: string, d: Partial<Input>, isCreate: boolean) => {
  const touched = d.outletIds !== undefined || d.allOutlets !== undefined;
  if (touched || isCreate) {
    const ids = d.allOutlets === true || (isCreate && !touched) ? await activeOutletIds(db, businessId) : (d.outletIds ?? []);
    await db.delete(promoOutlets).where(eq(promoOutlets.promoId, id));
    const unique = [...new Set(ids)];
    if (unique.length) await db.insert(promoOutlets).values(unique.map((outletId) => ({ promoId: id, outletId })));
  }
  if (d.salesTypeIds) {
    await db.delete(promoSalesTypes).where(eq(promoSalesTypes.promoId, id));
    const unique = [...new Set(d.salesTypeIds)];
    if (unique.length) await db.insert(promoSalesTypes).values(unique.map((salesTypeId) => ({ promoId: id, salesTypeId })));
  }
};

export const promoRoutes = () => {
  const app = new Hono<AppEnv>();
  const dup = (e: unknown) => (duplicateKey(e) ? new AppError("conflict", { fields: { name: "errors.duplicateName" } }) : e);

  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const db = c.get("db");
    const bid = c.get("auth").businessId;
    const where = and(eq(promos.businessId, bid), isNull(promos.deletedAt), q ? like(promos.name, contains(q)) : undefined);
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(promos).where(where);
    const rows = await db.select({ id: promos.id }).from(promos).where(where).orderBy(asc(promos.name)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ items: await load(db, bid, rows.map((r) => r.id)), total, page, pageSize });
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const [row] = await load(c.get("db"), c.get("auth").businessId, [c.req.valid("param").id]);
    if (!row) throw new AppError("not_found");
    return c.json(row);
  });

  app.post("/", requirePrivilege("library.manage"), validate("json", body), async (c) => {
    const data = c.req.valid("json");
    const rules = promoRules(data);
    if (Object.keys(rules).length) throw new AppError("validation", { fields: rules });
    const db = c.get("db");
    const auth = c.get("auth");
    await checkRefs(db, auth.businessId, data);
    const id = newId();
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const values: Record<string, unknown> = { id, businessId: auth.businessId };
        for (const k of COLUMNS) values[k] = (data as Record<string, unknown>)[k] ?? null;
        values.status = data.status;
        values.multiple = data.multiple;
        await t.insert(promos).values(values as never);
        await writeLinks(t, auth.businessId, id, data, true);
        await writeAudit(t, auth, { entityType: "promo", entityId: id, action: "create", summary: data.name, changes: { after: data } });
      });
    } catch (error) {
      throw dup(error);
    }
    return c.json((await load(db, auth.businessId, [id]))[0], 201);
  });

  app.patch("/:id", requirePrivilege("library.manage"), validate("param", idParam), validate("json", patchSchema(body)), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const db = c.get("db");
    const auth = c.get("auth");
    const [before] = await load(db, auth.businessId, [id]);
    if (!before) throw new AppError("not_found");
    const merged = { ...before, ...data, startsAt: data.startsAt === undefined ? (before.startsAt ? new Date(before.startsAt) : null) : data.startsAt, endsAt: data.endsAt === undefined ? (before.endsAt ? new Date(before.endsAt) : null) : data.endsAt } as Partial<Input>;
    const rules = promoRules(merged);
    if (Object.keys(rules).length) throw new AppError("validation", { fields: rules });
    await checkRefs(db, auth.businessId, data);
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const patch: Record<string, unknown> = {};
        for (const k of COLUMNS) if ((data as Record<string, unknown>)[k] !== undefined) patch[k] = (data as Record<string, unknown>)[k];
        if (Object.keys(patch).length) await t.update(promos).set(patch as never).where(and(eq(promos.id, id), eq(promos.businessId, auth.businessId)));
        await writeLinks(t, auth.businessId, id, data, false);
        const [after] = await load(t, auth.businessId, [id]);
        await writeAudit(t, auth, { entityType: "promo", entityId: id, action: "update", summary: before.name, changes: { before, after } });
      });
    } catch (error) {
      throw dup(error);
    }
    return c.json((await load(db, auth.businessId, [id]))[0]);
  });

  app.delete("/:id", requirePrivilege("library.manage"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const auth = c.get("auth");
    const [before] = await load(db, auth.businessId, [id]);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await t.update(promos).set({ deletedAt: new Date() }).where(and(eq(promos.id, id), eq(promos.businessId, auth.businessId)));
      await writeAudit(t, auth, { entityType: "promo", entityId: id, action: "delete", summary: before.name, changes: { before } });
    });
    return c.body(null, 204);
  });

  return app;
};
