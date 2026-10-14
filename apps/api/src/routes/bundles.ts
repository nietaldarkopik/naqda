import { and, asc, count, eq, inArray, isNull, like } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  bundleItems,
  bundleOutlets,
  bundlePrices,
  bundles,
  itemVariants,
  items,
  newId,
  outlets,
  salesTypes,
  type DbHandle,
} from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { activeOutletIds, contains, missingIn } from "../repo/generic";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });
const uuid = z.string().uuid();
const money = z.number().int().min(0).max(9_000_000_000_000);

const body = z.object({
  name: z.string().trim().min(1).max(191),
  price: money,
  status: z.enum(["active", "inactive"]).default("active"),
  items: z
    .array(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99).default(1) }))
    .min(1)
    .max(50)
    .refine((l) => new Set(l.map((i) => i.variantId)).size === l.length, "Varian ganda"),
  prices: z
    .array(z.object({ salesTypeId: uuid, price: money }))
    .max(100)
    .default([])
    .refine((l) => new Set(l.map((p) => p.salesTypeId)).size === l.length, "Sales type ganda"),
  outletIds: z.array(uuid).max(500).optional(),
  allOutlets: z.boolean().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

const load = async (db: Db, businessId: string, ids: string[]) => {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(bundles)
    .where(and(eq(bundles.businessId, businessId), isNull(bundles.deletedAt), inArray(bundles.id, ids)))
    .orderBy(asc(bundles.name));
  const parts = await db
    .select({
      bundleId: bundleItems.bundleId,
      variantId: bundleItems.variantId,
      quantity: bundleItems.quantity,
      variantName: itemVariants.name,
      itemName: items.name,
    })
    .from(bundleItems)
    .innerJoin(itemVariants, eq(bundleItems.variantId, itemVariants.id))
    .innerJoin(items, eq(itemVariants.itemId, items.id))
    .where(inArray(bundleItems.bundleId, ids));
  const prices = await db.select().from(bundlePrices).where(inArray(bundlePrices.bundleId, ids));
  const outs = await db.select().from(bundleOutlets).where(inArray(bundleOutlets.bundleId, ids));
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    price: b.price,
    status: b.status,
    items: parts.filter((p) => p.bundleId === b.id).map((p) => ({ variantId: p.variantId, quantity: p.quantity, itemName: p.itemName, variantName: p.variantName })),
    prices: prices.filter((p) => p.bundleId === b.id).map((p) => ({ salesTypeId: p.salesTypeId, price: p.price })),
    outletIds: outs.filter((o) => o.bundleId === b.id).map((o) => o.outletId),
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
  }));
};

const check = async (db: Db, businessId: string, d: Partial<z.infer<typeof body>>) => {
  const fields: Record<string, string> = {};
  if (d.items) {
    const found = await db
      .select({ id: itemVariants.id })
      .from(itemVariants)
      .innerJoin(items, eq(itemVariants.itemId, items.id))
      .where(and(eq(itemVariants.businessId, businessId), isNull(itemVariants.deletedAt), isNull(items.deletedAt), inArray(itemVariants.id, d.items.map((i) => i.variantId))));
    if (found.length !== new Set(d.items.map((i) => i.variantId)).size) fields.items = "errors.notFound";
  }
  if (d.prices && (await missingIn(db, salesTypes, businessId, d.prices.map((p) => p.salesTypeId))).length) fields.prices = "errors.notFound";
  if (d.outletIds && (await missingIn(db, outlets, businessId, d.outletIds)).length) fields.outletIds = "errors.notFound";
  if (Object.keys(fields).length) throw new AppError("validation", { fields });
};

const writeChildren = async (db: Db, businessId: string, id: string, d: Partial<z.infer<typeof body>>, isCreate: boolean) => {
  if (d.items) {
    await db.delete(bundleItems).where(eq(bundleItems.bundleId, id));
    await db.insert(bundleItems).values(d.items.map((i) => ({ bundleId: id, variantId: i.variantId, quantity: i.quantity })));
  }
  if (d.prices) {
    await db.delete(bundlePrices).where(eq(bundlePrices.bundleId, id));
    if (d.prices.length) await db.insert(bundlePrices).values(d.prices.map((p) => ({ bundleId: id, salesTypeId: p.salesTypeId, price: p.price })));
  }
  const touched = d.outletIds !== undefined || d.allOutlets !== undefined;
  if (touched || isCreate) {
    const ids = d.allOutlets === true || (isCreate && !touched) ? await activeOutletIds(db, businessId) : (d.outletIds ?? []);
    await db.delete(bundleOutlets).where(eq(bundleOutlets.bundleId, id));
    const unique = [...new Set(ids)];
    if (unique.length) await db.insert(bundleOutlets).values(unique.map((outletId) => ({ bundleId: id, outletId })));
  }
};

export const bundleRoutes = () => {
  const app = new Hono<AppEnv>();
  const dup = (e: unknown) => (duplicateKey(e) ? new AppError("conflict", { fields: { name: "errors.duplicateName" } }) : e);

  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const db = c.get("db");
    const bid = c.get("auth").businessId;
    const where = and(eq(bundles.businessId, bid), isNull(bundles.deletedAt), q ? like(bundles.name, contains(q)) : undefined);
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(bundles).where(where);
    const rows = await db.select({ id: bundles.id }).from(bundles).where(where).orderBy(asc(bundles.name)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ items: await load(db, bid, rows.map((r) => r.id)), total, page, pageSize });
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const [row] = await load(c.get("db"), c.get("auth").businessId, [c.req.valid("param").id]);
    if (!row) throw new AppError("not_found");
    return c.json(row);
  });

  app.post("/", requirePrivilege("library.manage"), validate("json", body), async (c) => {
    const data = c.req.valid("json");
    const db = c.get("db");
    const auth = c.get("auth");
    await check(db, auth.businessId, data);
    const id = newId();
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        await t.insert(bundles).values({ id, businessId: auth.businessId, name: data.name, price: data.price, status: data.status });
        await writeChildren(t, auth.businessId, id, data, true);
        await writeAudit(t, auth, { entityType: "bundle", entityId: id, action: "create", summary: data.name, changes: { after: data } });
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
    await check(db, auth.businessId, data);
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const patch: Record<string, unknown> = {};
        for (const k of ["name", "price", "status"] as const) if (data[k] !== undefined) patch[k] = data[k];
        if (Object.keys(patch).length) await t.update(bundles).set(patch).where(and(eq(bundles.id, id), eq(bundles.businessId, auth.businessId)));
        await writeChildren(t, auth.businessId, id, data, false);
        const [after] = await load(t, auth.businessId, [id]);
        await writeAudit(t, auth, { entityType: "bundle", entityId: id, action: "update", summary: before.name, changes: { before, after, priceChanged: before.price !== after?.price } });
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
      await t.update(bundles).set({ deletedAt: new Date() }).where(and(eq(bundles.id, id), eq(bundles.businessId, auth.businessId)));
      await writeAudit(t, auth, { entityType: "bundle", entityId: id, action: "delete", summary: before.name, changes: { before } });
    });
    return c.body(null, 204);
  });

  return app;
};
