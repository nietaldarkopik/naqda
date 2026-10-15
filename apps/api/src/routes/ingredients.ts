import { and, asc, count, eq, inArray, isNull, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ingredientRecipeLines, ingredients, itemVariants, items, modifierOptionIngredients, modifierOptions, modifierSets, newId, variantRecipeLines, type DbHandle } from "@naqdi/db";
import { fromScaled, toScaled } from "@naqdi/domain";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { contains } from "../repo/generic";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });
const uuid = z.string().uuid();

/** Bilangan desimal maksimal 3 angka di belakang koma; disimpan sebagai integer berskala 1000. */
const decimal = (min: number, max = 1_000_000_000) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "maks. 3 angka di belakang koma");
const qtyPositive = decimal(0.001);
const recipeLines = z
  .array(z.object({ componentId: uuid, quantity: qtyPositive }))
  .max(100)
  .refine((l) => new Set(l.map((x) => x.componentId)).size === l.length, "Bahan ganda");

const ingredientBody = z.object({
  name: z.string().trim().min(1).max(191),
  kind: z.enum(["raw", "semi"]).default("raw"),
  unit: z.string().trim().min(1).max(16),
  category: z.string().trim().max(120).nullish().transform((v) => v || null),
  trackStock: z.boolean().default(true),
  yieldQty: qtyPositive.default(1),
  defaultCost: decimal(0, 1_000_000_000).default(0),
  recipe: recipeLines.default([]),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
  kind: z.enum(["raw", "semi"]).optional(),
});

type Row = typeof ingredients.$inferSelect;

/** Bahan, resep bahan setengah jadi, resep varian item, dan stok modifier. Hak: inventory.manage (baca: backoffice.view). */
export const ingredientRoutes = () => {
  const app = new Hono<AppEnv>();

  const lines = async (db: Db, ids: string[]) => {
    const rows = ids.length ? await db.select().from(ingredientRecipeLines).where(inArray(ingredientRecipeLines.ingredientId, ids)) : [];
    const names = new Map<string, { name: string; unit: string }>();
    const compIds = [...new Set(rows.map((r) => r.componentId))];
    if (compIds.length) for (const r of await db.select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit }).from(ingredients).where(inArray(ingredients.id, compIds))) names.set(r.id, r);
    return (id: string) => rows.filter((r) => r.ingredientId === id).map((r) => ({ componentId: r.componentId, name: names.get(r.componentId)?.name ?? "?", unit: names.get(r.componentId)?.unit ?? "", quantity: fromScaled(r.quantity) }));
  };

  const present = (r: Row, recipe: ReturnType<Awaited<ReturnType<typeof lines>>>) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    unit: r.unit,
    category: r.category,
    trackStock: r.trackStock,
    yieldQty: fromScaled(r.yieldQty),
    defaultCost: fromScaled(r.defaultCost),
    recipe,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  });

  /** Resep bahan setengah jadi tidak boleh melingkar (A memakai B yang memakai A). */
  const assertNoCycle = async (db: Db, businessId: string, rootId: string, componentIds: string[]) => {
    if (componentIds.includes(rootId)) throw new AppError("validation", { fields: { recipe: "inventory.recipeCycle" } });
    const all = await db
      .select({ i: ingredientRecipeLines.ingredientId, c: ingredientRecipeLines.componentId })
      .from(ingredientRecipeLines)
      .innerJoin(ingredients, eq(ingredientRecipeLines.ingredientId, ingredients.id))
      .where(eq(ingredients.businessId, businessId));
    const graph = new Map<string, string[]>();
    for (const e of all) if (e.i !== rootId) graph.set(e.i, [...(graph.get(e.i) ?? []), e.c]);
    const seen = new Set<string>();
    const stack = [...componentIds];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === rootId) throw new AppError("validation", { fields: { recipe: "inventory.recipeCycle" } });
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(graph.get(n) ?? []));
    }
  };

  const assertComponents = async (db: Db, businessId: string, ids: string[]) => {
    if (ids.length === 0) return;
    const found = await db.select({ id: ingredients.id }).from(ingredients).where(and(eq(ingredients.businessId, businessId), isNull(ingredients.deletedAt), inArray(ingredients.id, ids)));
    if (found.length !== new Set(ids).size) throw new AppError("validation", { fields: { recipe: "errors.notFound" } });
  };

  const dup = (e: unknown) => (duplicateKey(e) ? new AppError("conflict", { fields: { name: "errors.duplicateName" } }) : e);

  // ---------------------------------------------------------------- bahan
  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q, kind } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const where = and(eq(ingredients.businessId, auth.businessId), isNull(ingredients.deletedAt), kind ? eq(ingredients.kind, kind) : undefined, q ? or(like(ingredients.name, contains(q)), like(ingredients.category, contains(q))) : undefined);
    const rows = await db.select().from(ingredients).where(where).orderBy(asc(ingredients.name)).limit(pageSize).offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(ingredients).where(where);
    const rl = await lines(db, rows.filter((r) => r.kind === "semi").map((r) => r.id));
    return c.json({ items: rows.map((r) => present(r, rl(r.id))), total: total?.n ?? 0, page, pageSize });
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const [r] = await c.get("db").select().from(ingredients).where(and(eq(ingredients.id, c.req.valid("param").id), eq(ingredients.businessId, c.get("auth").businessId), isNull(ingredients.deletedAt))).limit(1);
    if (!r) throw new AppError("not_found");
    return c.json(present(r, (await lines(c.get("db"), [r.id]))(r.id)));
  });

  app.post("/", requirePrivilege("inventory.manage"), validate("json", ingredientBody), async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    if (body.kind === "raw" && body.recipe.length > 0) throw new AppError("validation", { fields: { recipe: "inventory.rawNoRecipe" } });
    await assertComponents(db, auth.businessId, body.recipe.map((l) => l.componentId));
    const id = newId();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(ingredients).values({ id, businessId: auth.businessId, name: body.name, kind: body.kind, unit: body.unit, category: body.category, trackStock: body.trackStock, yieldQty: toScaled(body.yieldQty), defaultCost: toScaled(body.defaultCost) });
        if (body.recipe.length) await tx.insert(ingredientRecipeLines).values(body.recipe.map((l) => ({ ingredientId: id, componentId: l.componentId, quantity: toScaled(l.quantity) })));
        await writeAudit(tx as unknown as Db, auth, { entityType: "ingredient", entityId: id, action: "create", summary: body.name, changes: { after: { ...body, recipe: body.recipe.length } } });
      });
    } catch (e) {
      throw dup(e);
    }
    const [r] = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);
    return c.json(present(r!, (await lines(db, [id]))(id)), 201);
  });

  app.patch("/:id", requirePrivilege("inventory.manage"), validate("param", idParam), validate("json", patchSchema(ingredientBody)), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.businessId, auth.businessId), isNull(ingredients.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    const kind = body.kind ?? before.kind;
    if (body.recipe !== undefined) {
      if (kind === "raw" && body.recipe.length > 0) throw new AppError("validation", { fields: { recipe: "inventory.rawNoRecipe" } });
      await assertComponents(db, auth.businessId, body.recipe.map((l) => l.componentId));
      await assertNoCycle(db, auth.businessId, id, body.recipe.map((l) => l.componentId));
    }
    const set: Partial<typeof ingredients.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.kind !== undefined) set.kind = body.kind;
    if (body.unit !== undefined) set.unit = body.unit;
    if (body.category !== undefined) set.category = body.category;
    if (body.trackStock !== undefined) set.trackStock = body.trackStock;
    if (body.yieldQty !== undefined) set.yieldQty = toScaled(body.yieldQty);
    if (body.defaultCost !== undefined) set.defaultCost = toScaled(body.defaultCost);
    try {
      await db.transaction(async (tx) => {
        if (Object.keys(set).length) await tx.update(ingredients).set(set).where(eq(ingredients.id, id));
        if (body.recipe !== undefined || kind === "raw") {
          await tx.delete(ingredientRecipeLines).where(eq(ingredientRecipeLines.ingredientId, id));
          if (kind === "semi" && body.recipe?.length) await tx.insert(ingredientRecipeLines).values(body.recipe.map((l) => ({ ingredientId: id, componentId: l.componentId, quantity: toScaled(l.quantity) })));
        }
        await writeAudit(tx as unknown as Db, auth, { entityType: "ingredient", entityId: id, action: "update", summary: before.name, changes: { after: { ...body, recipe: body.recipe?.length } } });
      });
    } catch (e) {
      throw dup(e);
    }
    const [r] = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);
    return c.json(present(r!, (await lines(db, [id]))(id)));
  });

  app.delete("/:id", requirePrivilege("inventory.manage"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.businessId, auth.businessId), isNull(ingredients.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    const used = await Promise.all([
      db.select({ n: count() }).from(variantRecipeLines).where(eq(variantRecipeLines.ingredientId, id)),
      db.select({ n: count() }).from(modifierOptionIngredients).where(eq(modifierOptionIngredients.ingredientId, id)),
      db.select({ n: count() }).from(ingredientRecipeLines).where(eq(ingredientRecipeLines.componentId, id)),
    ]);
    if (used.some((u) => (u[0]?.n ?? 0) > 0)) throw new AppError("conflict", { messageKey: "inventory.ingredientInUse" });
    await db.transaction(async (tx) => {
      await tx.delete(ingredientRecipeLines).where(eq(ingredientRecipeLines.ingredientId, id));
      await tx.update(ingredients).set({ deletedAt: new Date() }).where(eq(ingredients.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "ingredient", entityId: id, action: "delete", summary: before.name });
    });
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- resep varian item
  const putSchema = z.object({
    lines: z
      .array(z.object({ ingredientId: uuid, quantity: qtyPositive }))
      .max(100)
      .refine((l) => new Set(l.map((x) => x.ingredientId)).size === l.length, "Bahan ganda"),
  });

  const readLines = async (db: Db, rows: { ingredientId: string; quantity: number }[]) => {
    const ids = [...new Set(rows.map((r) => r.ingredientId))];
    const names = new Map<string, { name: string; unit: string }>();
    if (ids.length) for (const r of await db.select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit }).from(ingredients).where(inArray(ingredients.id, ids))) names.set(r.id, r);
    return rows.map((r) => ({ ingredientId: r.ingredientId, name: names.get(r.ingredientId)?.name ?? "?", unit: names.get(r.ingredientId)?.unit ?? "", quantity: fromScaled(r.quantity) }));
  };

  app.get("/recipes/variants", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const where = and(eq(itemVariants.businessId, auth.businessId), isNull(itemVariants.deletedAt), isNull(items.deletedAt), q ? like(items.name, contains(q)) : undefined);
    const rows = await db
      .select({ id: itemVariants.id, item: items.name, variant: itemVariants.name, track: items.trackStock, cost: itemVariants.cost })
      .from(itemVariants)
      .innerJoin(items, eq(itemVariants.itemId, items.id))
      .where(where)
      .orderBy(asc(items.name), asc(itemVariants.position))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(itemVariants).innerJoin(items, eq(itemVariants.itemId, items.id)).where(where);
    const counts = new Map<string, number>();
    if (rows.length) for (const r of await db.select({ id: variantRecipeLines.variantId }).from(variantRecipeLines).where(inArray(variantRecipeLines.variantId, rows.map((r) => r.id)))) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    return c.json({ items: rows.map((r) => ({ id: r.id, item: r.item, variant: r.variant, trackStock: r.track, manualCost: r.cost, lineCount: counts.get(r.id) ?? 0 })), total: total?.n ?? 0, page, pageSize });
  });

  app.get("/recipes/variants/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const [v] = await db
      .select({ id: itemVariants.id, item: items.name, variant: itemVariants.name })
      .from(itemVariants)
      .innerJoin(items, eq(itemVariants.itemId, items.id))
      .where(and(eq(itemVariants.id, id), eq(itemVariants.businessId, c.get("auth").businessId)))
      .limit(1);
    if (!v) throw new AppError("not_found");
    return c.json({ ...v, lines: await readLines(db, await db.select().from(variantRecipeLines).where(eq(variantRecipeLines.variantId, id))) });
  });

  app.put("/recipes/variants/:id", requirePrivilege("inventory.manage"), validate("param", idParam), validate("json", putSchema), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [v] = await db.select({ id: itemVariants.id, item: items.name }).from(itemVariants).innerJoin(items, eq(itemVariants.itemId, items.id)).where(and(eq(itemVariants.id, id), eq(itemVariants.businessId, auth.businessId))).limit(1);
    if (!v) throw new AppError("not_found");
    await assertComponents(db, auth.businessId, body.lines.map((l) => l.ingredientId));
    await db.transaction(async (tx) => {
      await tx.delete(variantRecipeLines).where(eq(variantRecipeLines.variantId, id));
      if (body.lines.length) await tx.insert(variantRecipeLines).values(body.lines.map((l) => ({ variantId: id, ingredientId: l.ingredientId, quantity: toScaled(l.quantity) })));
      await writeAudit(tx as unknown as Db, auth, { entityType: "recipe", entityId: id, action: "update", summary: v.item, changes: { lines: body.lines.length } });
    });
    return c.json({ id, lines: await readLines(db, await db.select().from(variantRecipeLines).where(eq(variantRecipeLines.variantId, id))) });
  });

  // ---------------------------------------------------------------- stok modifier
  app.get("/recipes/options", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const where = and(eq(modifierOptions.businessId, auth.businessId), isNull(modifierOptions.deletedAt), isNull(modifierSets.deletedAt), q ? like(modifierOptions.name, contains(q)) : undefined);
    const rows = await db
      .select({ id: modifierOptions.id, option: modifierOptions.name, set: modifierSets.name })
      .from(modifierOptions)
      .innerJoin(modifierSets, eq(modifierOptions.setId, modifierSets.id))
      .where(where)
      .orderBy(asc(modifierSets.name), asc(modifierOptions.position))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(modifierOptions).innerJoin(modifierSets, eq(modifierOptions.setId, modifierSets.id)).where(where);
    const counts = new Map<string, number>();
    if (rows.length) for (const r of await db.select({ id: modifierOptionIngredients.optionId }).from(modifierOptionIngredients).where(inArray(modifierOptionIngredients.optionId, rows.map((r) => r.id)))) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    return c.json({ items: rows.map((r) => ({ ...r, lineCount: counts.get(r.id) ?? 0 })), total: total?.n ?? 0, page, pageSize });
  });

  app.get("/recipes/options/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const [o] = await db.select({ id: modifierOptions.id, option: modifierOptions.name, set: modifierSets.name }).from(modifierOptions).innerJoin(modifierSets, eq(modifierOptions.setId, modifierSets.id)).where(and(eq(modifierOptions.id, id), eq(modifierOptions.businessId, c.get("auth").businessId))).limit(1);
    if (!o) throw new AppError("not_found");
    return c.json({ ...o, lines: await readLines(db, await db.select().from(modifierOptionIngredients).where(eq(modifierOptionIngredients.optionId, id))) });
  });

  app.put("/recipes/options/:id", requirePrivilege("inventory.manage"), validate("param", idParam), validate("json", putSchema), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [o] = await db.select({ id: modifierOptions.id, option: modifierOptions.name }).from(modifierOptions).where(and(eq(modifierOptions.id, id), eq(modifierOptions.businessId, auth.businessId))).limit(1);
    if (!o) throw new AppError("not_found");
    await assertComponents(db, auth.businessId, body.lines.map((l) => l.ingredientId));
    await db.transaction(async (tx) => {
      await tx.delete(modifierOptionIngredients).where(eq(modifierOptionIngredients.optionId, id));
      if (body.lines.length) await tx.insert(modifierOptionIngredients).values(body.lines.map((l) => ({ optionId: id, ingredientId: l.ingredientId, quantity: toScaled(l.quantity) })));
      await writeAudit(tx as unknown as Db, auth, { entityType: "modifier_stock", entityId: id, action: "update", summary: o.option, changes: { lines: body.lines.length } });
    });
    return c.json({ id, lines: await readLines(db, await db.select().from(modifierOptionIngredients).where(eq(modifierOptionIngredients.optionId, id))) });
  });

  return app;
};
