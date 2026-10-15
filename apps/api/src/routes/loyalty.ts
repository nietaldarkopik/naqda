import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { categories, items, loyaltyEarnRules, loyaltyPrograms, loyaltyRewards, newId, type DbHandle } from "@naqdi/db";
import { isLocalDate } from "@naqdi/domain";
import { AppError } from "../errors";
import { iso, patchSchema, requireAnyPrivilege, requirePrivilege, validate, type AppEnv } from "../http";
import { getProgram, memberCount } from "../loyalty/service";
import { writeAudit } from "../repo/audit";

type Db = DbHandle["db"];
const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const date = z.string().refine(isLocalDate, "Tanggal tidak valid").nullable();
const money = z.number().int().min(0).max(9_000_000_000_000);

const programBody = z.object({
  enabled: z.boolean(),
  pointMode: z.enum(["spend", "item"]),
  spendAmount: money.refine((v) => v > 0, "harus lebih dari nol"),
  spendPoints: z.number().int().min(1).max(1_000_000),
  bonusNewMember: z.number().int().min(0).max(1_000_000).default(0),
  memberQuota: z.number().int().min(1).max(10_000_000).nullable().default(null),
  validFrom: date.default(null),
  validTo: date.default(null),
  requireCode: z.boolean().default(false),
  earnRules: z
    .array(z.object({ itemId: uuid.nullable().default(null), categoryId: uuid.nullable().default(null), pointsPerUnit: z.number().int().min(1).max(1_000_000) }))
    .max(500)
    .default([]),
});

const rewardBody = z.object({
  name: z.string().trim().min(1).max(191),
  pointsCost: z.number().int().min(1).max(100_000_000),
  kind: z.enum(["percent_total", "amount_total", "item_discount"]),
  valueKind: z.enum(["percent", "amount"]),
  value: money,
  maxDiscount: money.nullable().default(null),
  minPurchase: money.default(0),
  itemId: uuid.nullable().default(null),
  categoryId: uuid.nullable().default(null),
  status: z.enum(["active", "inactive"]).default("active"),
});

type RewardRow = typeof loyaltyRewards.$inferSelect;
const presentReward = (r: RewardRow) => ({ id: r.id, name: r.name, pointsCost: r.pointsCost, kind: r.kind, valueKind: r.valueKind, value: r.value, maxDiscount: r.maxDiscount, minPurchase: r.minPurchase, itemId: r.itemId, categoryId: r.categoryId, status: r.status });

/** Aturan konsistensi reward; mengembalikan galat per bidang. */
const checkReward = (r: z.infer<typeof rewardBody>): Record<string, string> | null => {
  if (r.kind === "percent_total" && (r.valueKind !== "percent" || r.value < 1 || r.value > 10_000)) return { value: "loyalty.percentRange" };
  if (r.kind === "amount_total" && (r.valueKind !== "amount" || r.value < 1)) return { value: "loyalty.amountRange" };
  if (r.kind === "item_discount") {
    if (r.valueKind === "percent" && (r.value < 1 || r.value > 10_000)) return { value: "loyalty.percentRange" };
    if (r.valueKind === "amount" && r.value < 1) return { value: "loyalty.amountRange" };
    if (Boolean(r.itemId) === Boolean(r.categoryId)) return { itemId: "loyalty.targetOne" };
  } else if (r.itemId || r.categoryId) return { itemId: "loyalty.targetNotAllowed" };
  if (r.valueKind === "amount" && r.maxDiscount !== null) return { maxDiscount: "loyalty.maxOnlyPercent" };
  return null;
};

/** Program loyalty dan reward. Menulis: customers.manage; melihat: customers.manage atau reports.view. */
export const loyaltyRoutes = () => {
  const app = new Hono<AppEnv>();
  const view = requireAnyPrivilege("customers.manage", "reports.view");
  const manage = requirePrivilege("customers.manage");

  const assertTargets = async (db: Db, businessId: string, itemIds: string[], categoryIds: string[]) => {
    if (itemIds.length) {
      const found = await db.select({ id: items.id }).from(items).where(and(eq(items.businessId, businessId), isNull(items.deletedAt), inArray(items.id, itemIds)));
      if (found.length !== new Set(itemIds).size) throw new AppError("validation", { fields: { itemId: "errors.notFound" } });
    }
    if (categoryIds.length) {
      const found = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.businessId, businessId), isNull(categories.deletedAt), inArray(categories.id, categoryIds)));
      if (found.length !== new Set(categoryIds).size) throw new AppError("validation", { fields: { categoryId: "errors.notFound" } });
    }
  };

  const presentProgram = async (db: Db, businessId: string) => {
    const p = await getProgram(db, businessId);
    const rules = await db.select().from(loyaltyEarnRules).where(eq(loyaltyEarnRules.businessId, businessId));
    return {
      enabled: p?.enabled ?? false,
      pointMode: p?.pointMode ?? "spend",
      spendAmount: p?.spendAmount ?? 10_000,
      spendPoints: p?.spendPoints ?? 1,
      bonusNewMember: p?.bonusNewMember ?? 0,
      memberQuota: p?.memberQuota ?? null,
      validFrom: p?.validFrom ?? null,
      validTo: p?.validTo ?? null,
      requireCode: p?.requireCode ?? false,
      earnRules: rules.map((r) => ({ itemId: r.itemId, categoryId: r.categoryId, pointsPerUnit: r.pointsPerUnit })),
      members: await memberCount(db, businessId),
      updatedAt: iso(p?.updatedAt ?? null),
    };
  };

  app.get("/program", view, async (c) => c.json(await presentProgram(c.get("db"), c.get("auth").businessId)));

  app.put("/program", manage, validate("json", programBody), async (c) => {
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    if (b.validFrom && b.validTo && b.validFrom > b.validTo) throw new AppError("validation", { fields: { validFrom: "reports.rangeOrder" } });
    if (b.earnRules.some((r) => Boolean(r.itemId) === Boolean(r.categoryId))) throw new AppError("validation", { fields: { earnRules: "loyalty.targetOne" } });
    await assertTargets(db, auth.businessId, b.earnRules.flatMap((r) => (r.itemId ? [r.itemId] : [])), b.earnRules.flatMap((r) => (r.categoryId ? [r.categoryId] : [])));
    if (b.memberQuota !== null && b.memberQuota < (await memberCount(db, auth.businessId))) throw new AppError("validation", { fields: { memberQuota: "loyalty.quotaBelowMembers" } });
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const values = { enabled: b.enabled, pointMode: b.pointMode, spendAmount: b.spendAmount, spendPoints: b.spendPoints, bonusNewMember: b.bonusNewMember, memberQuota: b.memberQuota, validFrom: b.validFrom, validTo: b.validTo, requireCode: b.requireCode };
      const existing = await getProgram(tx, auth.businessId);
      if (existing) await tx.update(loyaltyPrograms).set(values).where(eq(loyaltyPrograms.id, existing.id));
      else await tx.insert(loyaltyPrograms).values({ id: newId(), businessId: auth.businessId, ...values });
      await tx.delete(loyaltyEarnRules).where(eq(loyaltyEarnRules.businessId, auth.businessId));
      if (b.earnRules.length) await tx.insert(loyaltyEarnRules).values(b.earnRules.map((r) => ({ id: newId(), businessId: auth.businessId, itemId: r.itemId, categoryId: r.categoryId, pointsPerUnit: r.pointsPerUnit })));
      await writeAudit(tx, auth, { entityType: "loyalty_program", entityId: existing?.id ?? null, action: existing ? "update" : "create", summary: b.enabled ? "on" : "off", changes: { ...values, rules: b.earnRules.length } });
    });
    return c.json(await presentProgram(db, auth.businessId));
  });

  // ---------------------------------------------------------------- reward
  app.get("/rewards", view, async (c) => {
    const rows = await c.get("db").select().from(loyaltyRewards).where(and(eq(loyaltyRewards.businessId, c.get("auth").businessId), isNull(loyaltyRewards.deletedAt))).orderBy(asc(loyaltyRewards.pointsCost), asc(loyaltyRewards.name));
    return c.json({ items: rows.map(presentReward) });
  });

  app.post("/rewards", manage, validate("json", rewardBody), async (c) => {
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const bad = checkReward(b);
    if (bad) throw new AppError("validation", { fields: bad });
    await assertTargets(db, auth.businessId, b.itemId ? [b.itemId] : [], b.categoryId ? [b.categoryId] : []);
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(loyaltyRewards).values({ id, businessId: auth.businessId, ...b });
      await writeAudit(tx as unknown as Db, auth, { entityType: "loyalty_reward", entityId: id, action: "create", summary: b.name, changes: { after: b } });
    });
    const [r] = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, id)).limit(1);
    return c.json(presentReward(r!), 201);
  });

  app.patch("/rewards/:id", manage, validate("param", idParam), validate("json", patchSchema(rewardBody)), async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.businessId, auth.businessId), isNull(loyaltyRewards.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    const merged = rewardBody.parse({ ...presentReward(before), ...patch });
    const bad = checkReward(merged);
    if (bad) throw new AppError("validation", { fields: bad });
    await assertTargets(db, auth.businessId, merged.itemId ? [merged.itemId] : [], merged.categoryId ? [merged.categoryId] : []);
    await db.transaction(async (tx) => {
      await tx.update(loyaltyRewards).set(merged).where(eq(loyaltyRewards.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "loyalty_reward", entityId: id, action: "update", summary: before.name, changes: { after: patch } });
    });
    const [r] = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, id)).limit(1);
    return c.json(presentReward(r!));
  });

  app.delete("/rewards/:id", manage, validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.businessId, auth.businessId), isNull(loyaltyRewards.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      await tx.update(loyaltyRewards).set({ deletedAt: new Date() }).where(eq(loyaltyRewards.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "loyalty_reward", entityId: id, action: "delete", summary: before.name });
    });
    return c.body(null, 204);
  });

  return app;
};
