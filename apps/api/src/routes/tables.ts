import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { newId, orders, tableGroups, tables, type DbHandle } from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";

type Db = DbHandle["db"];
const idParam = z.object({ id: z.string().uuid() });
const outletQuery = z.object({ outletId: z.string().uuid() });
const name = z.string().trim().min(1).max(120);
const cell = z.number().int().min(0).max(200);

const groupBody = z.object({ outletId: z.string().uuid(), name, position: z.number().int().min(0).max(1000).default(0) });
const tableBody = z.object({
  outletId: z.string().uuid(),
  groupId: z.string().uuid().nullable().default(null),
  name,
  capacity: z.number().int().min(1).max(99).default(2),
  x: cell.default(0),
  y: cell.default(0),
  shape: z.enum(["rect", "round"]).default("rect"),
});

const presentGroup = (g: typeof tableGroups.$inferSelect) => ({ id: g.id, outletId: g.outletId, name: g.name, position: g.position });
const presentTable = (t: typeof tables.$inferSelect) => ({
  id: t.id,
  outletId: t.outletId,
  groupId: t.groupId,
  name: t.name,
  capacity: t.capacity,
  x: t.x,
  y: t.y,
  shape: t.shape,
  updatedAt: iso(t.updatedAt),
});

/** Grup meja dan meja per outlet (Back Office). Hak: tables.manage. Denah memakai posisi x/y pada kisi. */
export const tableRoutes = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("tables.manage"));

  const requireOutlet = async (c: { get: (k: "repo") => AppEnv["Variables"]["repo"] }, outletId: string) => {
    const outlet = await c.get("repo").outlets.get(outletId);
    if (!outlet) throw new AppError("validation", { fields: { outletId: "errors.notFound" } });
    return outlet;
  };
  const dupName = (e: unknown) => (duplicateKey(e) ? new AppError("conflict", { fields: { name: "tables.duplicate" } }) : e);

  const ensureGroup = async (db: Db, businessId: string, outletId: string, groupId: string | null) => {
    if (!groupId) return;
    const [g] = await db
      .select({ id: tableGroups.id })
      .from(tableGroups)
      .where(and(eq(tableGroups.id, groupId), eq(tableGroups.businessId, businessId), eq(tableGroups.outletId, outletId), isNull(tableGroups.deletedAt)))
      .limit(1);
    if (!g) throw new AppError("validation", { fields: { groupId: "errors.notFound" } });
  };

  // ---------------------------------------------------------------- grup
  app.get("/groups", validate("query", outletQuery), async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(tableGroups)
      .where(and(eq(tableGroups.businessId, c.get("auth").businessId), eq(tableGroups.outletId, c.req.valid("query").outletId), isNull(tableGroups.deletedAt)))
      .orderBy(asc(tableGroups.position), asc(tableGroups.name));
    return c.json({ items: rows.map(presentGroup) });
  });

  app.post("/groups", validate("json", groupBody), async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    await requireOutlet(c, body.outletId);
    const id = newId();
    try {
      await c.get("db").transaction(async (tx) => {
        await tx.insert(tableGroups).values({ id, businessId: auth.businessId, ...body });
        await writeAudit(tx as unknown as Db, auth, { entityType: "table_group", entityId: id, action: "create", summary: body.name, changes: { outletId: body.outletId } });
      });
    } catch (e) {
      throw dupName(e);
    }
    const [row] = await c.get("db").select().from(tableGroups).where(eq(tableGroups.id, id)).limit(1);
    return c.json(presentGroup(row!), 201);
  });

  app.patch("/groups/:id", validate("param", idParam), validate("json", patchSchema(groupBody.omit({ outletId: true }))), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(tableGroups).where(and(eq(tableGroups.id, id), eq(tableGroups.businessId, auth.businessId), isNull(tableGroups.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    try {
      await db.transaction(async (tx) => {
        await tx.update(tableGroups).set(body).where(eq(tableGroups.id, id));
        await writeAudit(tx as unknown as Db, auth, { entityType: "table_group", entityId: id, action: "update", summary: before.name, changes: { after: body } });
      });
    } catch (e) {
      throw dupName(e);
    }
    const [row] = await db.select().from(tableGroups).where(eq(tableGroups.id, id)).limit(1);
    return c.json(presentGroup(row!));
  });

  app.delete("/groups/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(tableGroups).where(and(eq(tableGroups.id, id), eq(tableGroups.businessId, auth.businessId), isNull(tableGroups.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      await tx.update(tables).set({ groupId: null }).where(eq(tables.groupId, id)); // meja tetap ada, hanya lepas dari grup
      await tx.update(tableGroups).set({ deletedAt: new Date() }).where(eq(tableGroups.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "table_group", entityId: id, action: "delete", summary: before.name });
    });
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- meja
  app.get("/", validate("query", outletQuery), async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(tables)
      .where(and(eq(tables.businessId, c.get("auth").businessId), eq(tables.outletId, c.req.valid("query").outletId), isNull(tables.deletedAt)))
      .orderBy(asc(tables.name));
    return c.json({ items: rows.map(presentTable) });
  });

  app.post("/", validate("json", tableBody), async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    await requireOutlet(c, body.outletId);
    await ensureGroup(db, auth.businessId, body.outletId, body.groupId);
    const id = newId();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(tables).values({ id, businessId: auth.businessId, ...body });
        await writeAudit(tx as unknown as Db, auth, { entityType: "table", entityId: id, action: "create", summary: body.name, changes: { outletId: body.outletId } });
      });
    } catch (e) {
      throw dupName(e);
    }
    const [row] = await db.select().from(tables).where(eq(tables.id, id)).limit(1);
    return c.json(presentTable(row!), 201);
  });

  // Simpan posisi banyak meja sekaligus (hasil geser di denah).
  app.put(
    "/layout",
    validate("json", z.object({ outletId: z.string().uuid(), items: z.array(z.object({ id: z.string().uuid(), x: cell, y: cell })).min(1).max(500) })),
    async (c) => {
      const { outletId, items } = c.req.valid("json");
      const auth = c.get("auth");
      const db = c.get("db");
      await requireOutlet(c, outletId);
      const rows = await db
        .select({ id: tables.id })
        .from(tables)
        .where(and(eq(tables.businessId, auth.businessId), eq(tables.outletId, outletId), isNull(tables.deletedAt), inArray(tables.id, items.map((i) => i.id))));
      if (rows.length !== new Set(items.map((i) => i.id)).size) throw new AppError("validation", { fields: { items: "errors.notFound" } });
      await db.transaction(async (tx) => {
        for (const i of items) await tx.update(tables).set({ x: i.x, y: i.y }).where(eq(tables.id, i.id));
        await writeAudit(tx as unknown as Db, auth, { entityType: "table", entityId: null, action: "update", summary: "layout", changes: { outletId, moved: items.length } });
      });
      return c.json({ saved: items.length });
    },
  );

  app.patch("/:id", validate("param", idParam), validate("json", patchSchema(tableBody.omit({ outletId: true }))), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.businessId, auth.businessId), isNull(tables.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    if (body.groupId !== undefined) await ensureGroup(db, auth.businessId, before.outletId, body.groupId);
    try {
      await db.transaction(async (tx) => {
        await tx.update(tables).set(body).where(eq(tables.id, id));
        await writeAudit(tx as unknown as Db, auth, { entityType: "table", entityId: id, action: "update", summary: before.name, changes: { after: body } });
      });
    } catch (e) {
      throw dupName(e);
    }
    const [row] = await db.select().from(tables).where(eq(tables.id, id)).limit(1);
    return c.json(presentTable(row!));
  });

  app.delete("/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.businessId, auth.businessId), isNull(tables.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    // Meja yang masih punya bill terbuka tidak boleh dihapus (bill akan kehilangan mejanya).
    const [open] = await db.select({ n: count() }).from(orders).where(and(eq(orders.tableId, id), eq(orders.status, "open")));
    if ((open?.n ?? 0) > 0) throw new AppError("conflict", { messageKey: "tables.hasOpenBills" });
    await db.transaction(async (tx) => {
      await tx.update(tables).set({ deletedAt: new Date() }).where(eq(tables.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "table", entityId: id, action: "delete", summary: before.name });
    });
    return c.body(null, 204);
  });

  return app;
};
