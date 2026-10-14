import { and, asc, count, eq, inArray, isNull, like } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { itemModifierSets, modifierOptions, modifierSets, newId, type DbHandle } from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { contains } from "../repo/generic";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });
const money = z.number().int().min(0).max(9_000_000_000_000);

const optionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(191),
  price: money.default(0),
});

const body = z.object({
  name: z.string().trim().min(1).max(191),
  minSelect: z.number().int().min(0).max(100).default(0),
  maxSelect: z.number().int().min(1).max(100).nullish(),
  options: z
    .array(optionSchema)
    .min(1)
    .max(100)
    .refine((list) => new Set(list.map((o) => o.name.toLowerCase())).size === list.length, "Nama opsi ganda"),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

type Input = z.infer<typeof body>;

const load = async (db: Db, businessId: string, ids: string[]) => {
  if (ids.length === 0) return [];
  const sets = await db
    .select()
    .from(modifierSets)
    .where(and(eq(modifierSets.businessId, businessId), isNull(modifierSets.deletedAt), inArray(modifierSets.id, ids)))
    .orderBy(asc(modifierSets.name));
  const options = await db
    .select()
    .from(modifierOptions)
    .where(and(inArray(modifierOptions.setId, ids), isNull(modifierOptions.deletedAt)))
    .orderBy(asc(modifierOptions.position));
  const usage = await db
    .select({ setId: itemModifierSets.setId, n: count() })
    .from(itemModifierSets)
    .where(inArray(itemModifierSets.setId, ids))
    .groupBy(itemModifierSets.setId);
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    minSelect: s.minSelect,
    maxSelect: s.maxSelect,
    itemCount: Number(usage.find((u) => u.setId === s.id)?.n ?? 0),
    options: options.filter((o) => o.setId === s.id).map((o) => ({ id: o.id, name: o.name, price: o.price })),
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  }));
};

const validateRange = (d: Pick<Input, "minSelect" | "maxSelect" | "options">) => {
  const fields: Record<string, string> = {};
  if (d.maxSelect != null && d.maxSelect < d.minSelect) fields.maxSelect = "errors.validation";
  if (d.minSelect > d.options.length) fields.minSelect = "errors.validation";
  if (Object.keys(fields).length) throw new AppError("validation", { fields });
};

export const modifierRoutes = () => {
  const app = new Hono<AppEnv>();
  const dup = (error: unknown) =>
    duplicateKey(error) ? new AppError("conflict", { fields: { name: "errors.duplicateName" } }) : error;

  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const db = c.get("db");
    const bid = c.get("auth").businessId;
    const where = and(eq(modifierSets.businessId, bid), isNull(modifierSets.deletedAt), q ? like(modifierSets.name, contains(q)) : undefined);
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(modifierSets).where(where);
    const rows = await db.select({ id: modifierSets.id }).from(modifierSets).where(where).orderBy(asc(modifierSets.name)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ items: await load(db, bid, rows.map((r) => r.id)), total, page, pageSize });
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const [row] = await load(c.get("db"), c.get("auth").businessId, [c.req.valid("param").id]);
    if (!row) throw new AppError("not_found");
    return c.json(row);
  });

  app.post("/", requirePrivilege("library.manage"), validate("json", body), async (c) => {
    const data = c.req.valid("json");
    validateRange(data);
    const db = c.get("db");
    const auth = c.get("auth");
    const id = newId();
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        await t.insert(modifierSets).values({ id, businessId: auth.businessId, name: data.name, minSelect: data.minSelect, maxSelect: data.maxSelect ?? null });
        await t.insert(modifierOptions).values(data.options.map((o, position) => ({ id: newId(), businessId: auth.businessId, setId: id, name: o.name, price: o.price, position })));
        await writeAudit(t, auth, { entityType: "modifier_set", entityId: id, action: "create", summary: data.name, changes: { after: data } });
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
    const merged = {
      minSelect: data.minSelect ?? before.minSelect,
      maxSelect: data.maxSelect === undefined ? before.maxSelect : data.maxSelect,
      options: data.options ?? before.options,
    };
    validateRange(merged);
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const patch: Record<string, unknown> = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.minSelect !== undefined) patch.minSelect = data.minSelect;
        if (data.maxSelect !== undefined) patch.maxSelect = data.maxSelect;
        if (Object.keys(patch).length) await t.update(modifierSets).set(patch).where(and(eq(modifierSets.id, id), eq(modifierSets.businessId, auth.businessId)));
        if (data.options) {
          const keep = new Set(data.options.map((o) => o.id).filter((x): x is string => Boolean(x)));
          const own = new Set(before.options.map((o) => o.id));
          for (const k of keep) if (!own.has(k)) throw new AppError("validation", { fields: { options: "errors.notFound" } });
          const removed = [...own].filter((oid) => !keep.has(oid));
          if (removed.length) await t.update(modifierOptions).set({ deletedAt: new Date() }).where(inArray(modifierOptions.id, removed));
          for (const [position, o] of data.options.entries()) {
            if (o.id) await t.update(modifierOptions).set({ name: o.name, price: o.price, position }).where(and(eq(modifierOptions.id, o.id), eq(modifierOptions.setId, id)));
            else await t.insert(modifierOptions).values({ id: newId(), businessId: auth.businessId, setId: id, name: o.name, price: o.price, position });
          }
        }
        const [after] = await load(t, auth.businessId, [id]);
        await writeAudit(t, auth, { entityType: "modifier_set", entityId: id, action: "update", summary: before.name, changes: { before, after } });
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
      await t.update(modifierSets).set({ deletedAt: new Date() }).where(and(eq(modifierSets.id, id), eq(modifierSets.businessId, auth.businessId)));
      await t.delete(itemModifierSets).where(eq(itemModifierSets.setId, id));
      await writeAudit(t, auth, { entityType: "modifier_set", entityId: id, action: "delete", summary: before.name, changes: { before } });
    });
    return c.body(null, 204);
  });

  return app;
};
