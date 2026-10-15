import { and, asc, count, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ingredientRecipeLines,
  ingredients,
  itemVariants,
  items,
  newId,
  outlets,
  purchaseOrderLines,
  purchaseOrders,
  stockAdjustments,
  stockLevels,
  stockMovements,
  suppliers,
  transferLines,
  transfers,
  users,
  type DbHandle,
  type SubjectType,
} from "@naqdi/db";
import { findShortages, fromScaled, mergeRequirements, mulDivRound, toScaled } from "@naqdi/domain";
import { AppError } from "../errors";
import { iso, requireAnyPrivilege, requirePrivilege, validate, type AppEnv } from "../http";
import { applyMove, keyOf, lockLevels, type Subject } from "../inventory/ledger";
import { nextNumber } from "../inventory/numbers";
import { writeAudit } from "../repo/audit";
import { contains } from "../repo/generic";
import { assignedOutlets, requireOutletAccess } from "../repo/outlet-access";

type Db = DbHandle["db"];

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const decimal = (min: number, max = 1_000_000_000) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "maks. 3 angka di belakang koma");
const qty = decimal(0.001);
const subject = z.object({ subjectType: z.enum(["variant", "ingredient"]), subjectId: uuid });
const paging = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

interface SubjectInfo {
  name: string;
  unit: string;
}

/** Nama dan satuan; hanya objek yang dilacak stoknya yang valid. */
const resolveSubjects = async (db: Db, businessId: string, subjects: readonly Subject[]): Promise<Map<string, SubjectInfo>> => {
  const out = new Map<string, SubjectInfo>();
  const vIds = subjects.filter((s) => s.subjectType === "variant").map((s) => s.subjectId);
  const iIds = subjects.filter((s) => s.subjectType === "ingredient").map((s) => s.subjectId);
  if (vIds.length) {
    for (const r of await db
      .select({ id: itemVariants.id, item: items.name, variant: itemVariants.name })
      .from(itemVariants)
      .innerJoin(items, eq(itemVariants.itemId, items.id))
      .where(and(inArray(itemVariants.id, vIds), eq(itemVariants.businessId, businessId), isNull(itemVariants.deletedAt), isNull(items.deletedAt), eq(items.trackStock, true)))) {
      out.set(`variant:${r.id}`, { name: r.variant && r.variant !== r.item ? `${r.item} (${r.variant})` : r.item, unit: "pcs" });
    }
  }
  if (iIds.length) {
    for (const r of await db
      .select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit })
      .from(ingredients)
      .where(and(inArray(ingredients.id, iIds), eq(ingredients.businessId, businessId), isNull(ingredients.deletedAt), eq(ingredients.trackStock, true)))) {
      out.set(`ingredient:${r.id}`, { name: r.name, unit: r.unit });
    }
  }
  const missing = subjects.filter((s) => !out.has(keyOf(s)));
  if (missing.length) throw new AppError("validation", { fields: { lines: "inventory.notTracked" } });
  return out;
};

/** Daftar nama untuk riwayat dan ringkasan (termasuk objek yang sudah tidak dilacak). */
export const subjectNames = async (db: Db, businessId: string, subjects: readonly Subject[]): Promise<Map<string, SubjectInfo>> => {
  const out = new Map<string, SubjectInfo>();
  const vIds = [...new Set(subjects.filter((s) => s.subjectType === "variant").map((s) => s.subjectId))];
  const iIds = [...new Set(subjects.filter((s) => s.subjectType === "ingredient").map((s) => s.subjectId))];
  for (let i = 0; i < vIds.length; i += 1000) {
    for (const r of await db.select({ id: itemVariants.id, item: items.name, variant: itemVariants.name }).from(itemVariants).innerJoin(items, eq(itemVariants.itemId, items.id)).where(and(inArray(itemVariants.id, vIds.slice(i, i + 1000)), eq(itemVariants.businessId, businessId)))) {
      out.set(`variant:${r.id}`, { name: r.variant && r.variant !== r.item ? `${r.item} (${r.variant})` : r.item, unit: "pcs" });
    }
  }
  for (let i = 0; i < iIds.length; i += 1000) {
    for (const r of await db.select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit }).from(ingredients).where(and(inArray(ingredients.id, iIds.slice(i, i + 1000)), eq(ingredients.businessId, businessId)))) out.set(`ingredient:${r.id}`, { name: r.name, unit: r.unit });
  }
  return out;
};

const noDuplicates = (lines: readonly Subject[]) => new Set(lines.map(keyOf)).size === lines.length;

/** Stok, pembelian (PO), transfer, penyesuaian, dan produksi. Hak: inventory.manage (melihat: juga reports.view). */
export const inventoryRoutes = () => {
  const app = new Hono<AppEnv>();
  const view = requireAnyPrivilege("inventory.manage", "reports.view");
  const manage = requirePrivilege("inventory.manage");

  // ---------------------------------------------------------------- pemilih objek dan daftar stok
  app.get("/subjects", view, validate("query", z.object({ q: z.string().trim().max(100).optional(), type: z.enum(["variant", "ingredient"]).optional() })), async (c) => {
    const { q, type } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const out: { subjectType: SubjectType; subjectId: string; name: string; unit: string }[] = [];
    if (type !== "ingredient") {
      for (const r of await db
        .select({ id: itemVariants.id, item: items.name, variant: itemVariants.name })
        .from(itemVariants)
        .innerJoin(items, eq(itemVariants.itemId, items.id))
        .where(and(eq(itemVariants.businessId, auth.businessId), isNull(itemVariants.deletedAt), isNull(items.deletedAt), eq(items.trackStock, true), q ? like(items.name, contains(q)) : undefined))
        .orderBy(asc(items.name))
        .limit(50)) out.push({ subjectType: "variant", subjectId: r.id, name: r.variant && r.variant !== r.item ? `${r.item} (${r.variant})` : r.item, unit: "pcs" });
    }
    if (type !== "variant") {
      for (const r of await db
        .select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit })
        .from(ingredients)
        .where(and(eq(ingredients.businessId, auth.businessId), isNull(ingredients.deletedAt), eq(ingredients.trackStock, true), q ? like(ingredients.name, contains(q)) : undefined))
        .orderBy(asc(ingredients.name))
        .limit(50)) out.push({ subjectType: "ingredient", subjectId: r.id, name: r.name, unit: r.unit });
    }
    return c.json({ items: out });
  });

  const outletQuery = z.object({ outletId: uuid });

  app.get(
    "/stock",
    view,
    validate("query", outletQuery.merge(paging).extend({ type: z.enum(["variant", "ingredient"]).optional(), status: z.enum(["out", "low", "ok"]).optional(), q: z.string().trim().max(100).optional() })),
    async (c) => {
      const { outletId, page, pageSize, type, status, q } = c.req.valid("query");
      const auth = c.get("auth");
      const db = c.get("db");
      await requireOutletAccess(db, auth, outletId);
      const levels = new Map<string, { quantity: number; avgCost: number; alertLow: number }>();
      for (const r of await db.select().from(stockLevels).where(eq(stockLevels.outletId, outletId))) levels.set(keyOf(r), r);
      type Row = { subjectType: SubjectType; subjectId: string; name: string; unit: string; kind: string };
      const rows: Row[] = [];
      if (type !== "ingredient") {
        for (const r of await db
          .select({ id: itemVariants.id, item: items.name, variant: itemVariants.name })
          .from(itemVariants)
          .innerJoin(items, eq(itemVariants.itemId, items.id))
          .where(and(eq(itemVariants.businessId, auth.businessId), isNull(itemVariants.deletedAt), isNull(items.deletedAt), eq(items.trackStock, true)))) {
          rows.push({ subjectType: "variant", subjectId: r.id, name: r.variant && r.variant !== r.item ? `${r.item} (${r.variant})` : r.item, unit: "pcs", kind: "item" });
        }
      }
      if (type !== "variant") {
        for (const r of await db.select().from(ingredients).where(and(eq(ingredients.businessId, auth.businessId), isNull(ingredients.deletedAt), eq(ingredients.trackStock, true)))) {
          rows.push({ subjectType: "ingredient", subjectId: r.id, name: r.name, unit: r.unit, kind: r.kind });
        }
      }
      const shown = rows
        .map((r) => {
          const l = levels.get(keyOf(r)) ?? { quantity: 0, avgCost: 0, alertLow: 0 };
          const st = l.quantity <= 0 ? "out" : l.alertLow > 0 && l.quantity <= l.alertLow ? "low" : "ok";
          return { ...r, quantity: fromScaled(l.quantity), avgCost: fromScaled(l.avgCost), alertLow: fromScaled(l.alertLow), value: Math.round((l.quantity * l.avgCost) / 1_000_000), status: st };
        })
        .filter((r) => (!status || r.status === status) && (!q || r.name.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => a.name.localeCompare(b.name));
      return c.json({ items: shown.slice((page - 1) * pageSize, page * pageSize), total: shown.length, page, pageSize, totalValue: shown.reduce((a, r) => a + r.value, 0) });
    },
  );

  app.put("/stock/alert", manage, validate("json", subject.extend({ outletId: uuid, alertLow: decimal(0) })), async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    await requireOutletAccess(db, auth, body.outletId);
    await resolveSubjects(db, auth.businessId, [body]);
    await db.transaction(async (tx) => {
      await lockLevels(tx as unknown as Db, body.outletId, [body]);
      await tx.update(stockLevels).set({ alertLow: toScaled(body.alertLow) }).where(and(eq(stockLevels.outletId, body.outletId), eq(stockLevels.subjectType, body.subjectType), eq(stockLevels.subjectId, body.subjectId)));
    });
    return c.json({ ok: true });
  });

  app.get("/movements", view, validate("query", outletQuery.merge(paging).extend({ subjectType: z.enum(["variant", "ingredient"]).optional(), subjectId: uuid.optional() })), async (c) => {
    const { outletId, page, pageSize, subjectType, subjectId } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    await requireOutletAccess(db, auth, outletId);
    const where = and(eq(stockMovements.outletId, outletId), subjectType ? eq(stockMovements.subjectType, subjectType) : undefined, subjectId ? eq(stockMovements.subjectId, subjectId) : undefined);
    const rows = await db.select({ m: stockMovements, user: users.name }).from(stockMovements).leftJoin(users, eq(stockMovements.userId, users.id)).where(where).orderBy(desc(stockMovements.createdAt), desc(stockMovements.id)).limit(pageSize).offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(stockMovements).where(where);
    const names = await subjectNames(db, auth.businessId, rows.map((r) => r.m));
    return c.json({
      items: rows.map(({ m, user }) => ({
        id: m.id,
        at: iso(m.createdAt),
        kind: m.kind,
        subjectType: m.subjectType,
        subjectId: m.subjectId,
        name: names.get(keyOf(m))?.name ?? "?",
        unit: names.get(keyOf(m))?.unit ?? "",
        delta: fromScaled(m.delta),
        unitCost: fromScaled(m.unitCost),
        value: m.value,
        balanceAfter: fromScaled(m.balanceAfter),
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        user,
      })),
      total: total?.n ?? 0,
      page,
      pageSize,
    });
  });

  // ---------------------------------------------------------------- produksi bahan setengah jadi
  app.post("/produce", manage, validate("json", z.object({ outletId: uuid, ingredientId: uuid, batches: qty })), async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    await requireOutletAccess(db, auth, body.outletId);
    const [semi] = await db.select().from(ingredients).where(and(eq(ingredients.id, body.ingredientId), eq(ingredients.businessId, auth.businessId), isNull(ingredients.deletedAt))).limit(1);
    if (!semi || semi.kind !== "semi") throw new AppError("validation", { fields: { ingredientId: "inventory.notSemi" } });
    const recipe = await db.select().from(ingredientRecipeLines).where(eq(ingredientRecipeLines.ingredientId, semi.id));
    if (recipe.length === 0) throw new AppError("validation", { fields: { ingredientId: "inventory.noRecipe" } });
    const batches = toScaled(body.batches);
    const refId = newId();
    const produced = mulDivRound(semi.yieldQty, batches, 1000);
    let unitCost = 0;
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const needs = mergeRequirements(recipe.map((r) => ({ subjectType: "ingredient" as const, subjectId: r.componentId, quantity: mulDivRound(r.quantity, batches, 1000) })));
      const levels = await lockLevels(tx, body.outletId, [...needs, { subjectType: "ingredient", subjectId: semi.id }]);
      const [outlet] = await tx.select({ mode: outlets.stockMode }).from(outlets).where(eq(outlets.id, body.outletId)).limit(1);
      if (outlet?.mode !== "off") {
        const short = findShortages(needs, levels);
        if (short.length) throw new AppError("validation", { fields: { batches: "inventory.insufficient" }, extra: { short: short.map((s) => ({ id: s.subjectId, needed: fromScaled(s.needed), available: fromScaled(s.available) })) } });
      }
      const ctx = { businessId: auth.businessId, outletId: body.outletId, userId: auth.userId, refType: "production", refId };
      let total = 0;
      for (const n of needs) {
        const r = await applyMove(tx, ctx, levels, n, "production_out", -n.quantity);
        total += -r.value;
      }
      unitCost = mulDivRound(total, 1_000_000, produced);
      await applyMove(tx, ctx, levels, { subjectType: "ingredient", subjectId: semi.id }, "production_in", produced, unitCost);
      await writeAudit(tx, auth, { entityType: "production", entityId: refId, action: "create", summary: semi.name, changes: { batches: body.batches, produced: fromScaled(produced) } });
    });
    return c.json({ id: refId, produced: fromScaled(produced), unitCost: fromScaled(unitCost) }, 201);
  });

  // ---------------------------------------------------------------- pembelian (PO)
  const poLines = z
    .array(subject.extend({ quantity: qty, unitCost: decimal(0, 1_000_000_000) }))
    .min(1)
    .max(200)
    .refine(noDuplicates, "Objek ganda");

  /** Menerima barang dari PO (seluruhnya atau sebagian); biaya rata-rata diperbarui dengan harga beli. */
  const receivePo = async (tx: Db, auth: { businessId: string; userId: string }, po: typeof purchaseOrders.$inferSelect, input?: { lineId: string; quantity: number }[]) => {
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
    const wanted = new Map<string, number>();
    if (input) {
      for (const i of input) {
        if (!lines.some((l) => l.id === i.lineId)) throw new AppError("validation", { fields: { lines: "errors.notFound" } });
        wanted.set(i.lineId, toScaled(i.quantity));
      }
    } else for (const l of lines) wanted.set(l.id, l.quantity - l.receivedQty);
    const levels = await lockLevels(tx, po.outletId, lines.filter((l) => (wanted.get(l.id) ?? 0) > 0));
    for (const l of lines) {
      const q = wanted.get(l.id) ?? 0;
      if (q <= 0) continue;
      if (q > l.quantity - l.receivedQty) throw new AppError("validation", { fields: { lines: "inventory.overReceive" } });
      await applyMove(tx, { businessId: auth.businessId, outletId: po.outletId, userId: auth.userId, refType: "po", refId: po.id, note: `PO #${po.number}` }, levels, l, "purchase", q, l.unitCost);
      await tx.update(purchaseOrderLines).set({ receivedQty: l.receivedQty + q }).where(eq(purchaseOrderLines.id, l.id));
      l.receivedQty += q;
    }
    const done = lines.every((l) => l.receivedQty >= l.quantity);
    const any = lines.some((l) => l.receivedQty > 0);
    await tx.update(purchaseOrders).set({ status: done ? "completed" : any ? "partial" : "waiting", completedAt: done ? new Date() : null }).where(eq(purchaseOrders.id, po.id));
  };

  const presentPo = async (db: Db, po: typeof purchaseOrders.$inferSelect, withLines: boolean) => {
    const [sup] = po.supplierId ? await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1) : [];
    const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
    const total = lines.reduce((a, l) => a + Math.round((l.quantity * l.unitCost) / 1_000_000), 0);
    return {
      id: po.id,
      number: po.number,
      outletId: po.outletId,
      supplierId: po.supplierId,
      supplier: sup?.name ?? null,
      status: po.status,
      note: po.note,
      total,
      createdAt: iso(po.createdAt),
      completedAt: iso(po.completedAt),
      ...(withLines
        ? { lines: lines.map((l) => ({ id: l.id, subjectType: l.subjectType, subjectId: l.subjectId, name: l.name, quantity: fromScaled(l.quantity), unitCost: fromScaled(l.unitCost), receivedQty: fromScaled(l.receivedQty), subtotal: Math.round((l.quantity * l.unitCost) / 1_000_000) })) }
        : {}),
    };
  };

  app.post("/purchase-orders", manage, validate("json", z.object({ outletId: uuid, supplierId: uuid.nullish(), note: z.string().trim().max(500).nullish(), lines: poLines, fulfill: z.boolean().default(false) })), async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    await requireOutletAccess(db, auth, body.outletId);
    if (body.supplierId) {
      const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, body.supplierId), eq(suppliers.businessId, auth.businessId), isNull(suppliers.deletedAt))).limit(1);
      if (!s) throw new AppError("validation", { fields: { supplierId: "errors.notFound" } });
    }
    const names = await resolveSubjects(db, auth.businessId, body.lines);
    const id = newId();
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const number = await nextNumber(tx, body.outletId, "po");
      await tx.insert(purchaseOrders).values({ id, businessId: auth.businessId, outletId: body.outletId, supplierId: body.supplierId ?? null, number, note: body.note ?? null, createdBy: auth.userId });
      await tx.insert(purchaseOrderLines).values(body.lines.map((l) => ({ id: newId(), poId: id, subjectType: l.subjectType, subjectId: l.subjectId, name: names.get(keyOf(l))!.name, quantity: toScaled(l.quantity), unitCost: toScaled(l.unitCost) })));
      await writeAudit(tx, auth, { entityType: "purchase_order", entityId: id, action: "create", summary: `PO #${number}`, changes: { lines: body.lines.length, fulfill: body.fulfill } });
      if (body.fulfill) {
        const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
        await receivePo(tx, auth, po!);
      }
    });
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    return c.json(await presentPo(db, po!, true), 201);
  });

  const listScope = async (db: Db, auth: { userId: string; businessId: string }, outletId?: string) => {
    const mine = await assignedOutlets(db, auth);
    if (outletId && !mine.some((o) => o.id === outletId)) throw new AppError("forbidden");
    return outletId ? [outletId] : mine.map((o) => o.id);
  };

  app.get("/purchase-orders", view, validate("query", paging.extend({ outletId: uuid.optional(), status: z.enum(["waiting", "partial", "completed", "cancelled"]).optional() })), async (c) => {
    const { page, pageSize, outletId, status } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const ids = await listScope(db, auth, outletId);
    if (ids.length === 0) return c.json({ items: [], total: 0, page, pageSize });
    const where = and(eq(purchaseOrders.businessId, auth.businessId), inArray(purchaseOrders.outletId, ids), status ? eq(purchaseOrders.status, status) : undefined);
    const rows = await db.select().from(purchaseOrders).where(where).orderBy(desc(purchaseOrders.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(purchaseOrders).where(where);
    const outletName = new Map((await assignedOutlets(db, auth)).map((o) => [o.id, o.name]));
    return c.json({ items: await Promise.all(rows.map(async (r) => ({ ...(await presentPo(db, r, false)), outlet: outletName.get(r.outletId) ?? "-" }))), total: total?.n ?? 0, page, pageSize });
  });

  const loadPo = async (db: Db, auth: { userId: string; businessId: string }, id: string) => {
    const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.businessId, auth.businessId))).limit(1);
    if (!po) throw new AppError("not_found");
    await requireOutletAccess(db, auth, po.outletId);
    return po;
  };

  app.get("/purchase-orders/:id", view, validate("param", idParam), async (c) => c.json(await presentPo(c.get("db"), await loadPo(c.get("db"), c.get("auth"), c.req.valid("param").id), true)));

  app.post("/purchase-orders/:id/fulfill", manage, validate("param", idParam), validate("json", z.object({ lines: z.array(z.object({ lineId: uuid, quantity: qty })).max(200).optional() })), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const po0 = await loadPo(db, auth, c.req.valid("param").id);
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po0.id)).limit(1).for("update");
      if (!po || po.status === "completed" || po.status === "cancelled") throw new AppError("conflict", { messageKey: "inventory.poClosed" });
      await receivePo(tx, auth, po, c.req.valid("json").lines);
      await writeAudit(tx, auth, { entityType: "purchase_order", entityId: po.id, action: "update", summary: `PO #${po.number}`, changes: { received: true } });
    });
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po0.id)).limit(1);
    return c.json(await presentPo(db, po!, true));
  });

  app.post("/purchase-orders/:id/cancel", manage, validate("param", idParam), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const po0 = await loadPo(db, auth, c.req.valid("param").id);
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po0.id)).limit(1).for("update");
      if (!po || po.status !== "waiting") throw new AppError("conflict", { messageKey: "inventory.poClosed" });
      await tx.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, po.id));
      await writeAudit(tx, auth, { entityType: "purchase_order", entityId: po.id, action: "update", summary: `PO #${po.number}`, changes: { cancelled: true } });
    });
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po0.id)).limit(1);
    return c.json(await presentPo(db, po!, true));
  });

  // ---------------------------------------------------------------- transfer antar outlet
  const presentTransfer = async (db: Db, t: typeof transfers.$inferSelect, withLines: boolean) => {
    const lines = await db.select().from(transferLines).where(eq(transferLines.transferId, t.id));
    const outletName = new Map<string, string>();
    for (const r of await db.select({ id: outlets.id, name: outlets.name }).from(outlets).where(inArray(outlets.id, [t.fromOutletId, t.toOutletId]))) outletName.set(r.id, r.name);
    return {
      id: t.id,
      number: t.number,
      fromOutletId: t.fromOutletId,
      toOutletId: t.toOutletId,
      from: outletName.get(t.fromOutletId) ?? "-",
      to: outletName.get(t.toOutletId) ?? "-",
      status: t.status,
      note: t.note,
      createdAt: iso(t.createdAt),
      receivedAt: iso(t.receivedAt),
      lineCount: lines.length,
      ...(withLines ? { lines: lines.map((l) => ({ id: l.id, subjectType: l.subjectType, subjectId: l.subjectId, name: l.name, quantity: fromScaled(l.quantity), receivedQty: fromScaled(l.receivedQty), unitCost: fromScaled(l.unitCost) })) } : {}),
    };
  };

  app.post(
    "/transfers",
    manage,
    validate("json", z.object({ fromOutletId: uuid, toOutletId: uuid, note: z.string().trim().max(500).nullish(), lines: z.array(subject.extend({ quantity: qty })).min(1).max(200).refine(noDuplicates, "Objek ganda") })),
    async (c) => {
      const body = c.req.valid("json");
      const auth = c.get("auth");
      const db = c.get("db");
      if (body.fromOutletId === body.toOutletId) throw new AppError("validation", { fields: { toOutletId: "inventory.sameOutlet" } });
      await requireOutletAccess(db, auth, body.fromOutletId);
      if (!(await c.get("repo").outlets.get(body.toOutletId))) throw new AppError("validation", { fields: { toOutletId: "errors.notFound" } });
      const names = await resolveSubjects(db, auth.businessId, body.lines);
      const id = newId();
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const levels = await lockLevels(tx, body.fromOutletId, body.lines);
        const needs = body.lines.map((l) => ({ subjectType: l.subjectType, subjectId: l.subjectId, quantity: toScaled(l.quantity) }));
        const short = findShortages(needs, levels);
        if (short.length) throw new AppError("validation", { fields: { lines: "inventory.insufficient" }, extra: { short: short.map((s) => ({ name: names.get(keyOf(s))?.name, needed: fromScaled(s.needed), available: fromScaled(s.available) })) } });
        const number = await nextNumber(tx, body.fromOutletId, "tr");
        await tx.insert(transfers).values({ id, businessId: auth.businessId, fromOutletId: body.fromOutletId, toOutletId: body.toOutletId, number, note: body.note ?? null, createdBy: auth.userId });
        for (const n of needs) {
          const r = await applyMove(tx, { businessId: auth.businessId, outletId: body.fromOutletId, userId: auth.userId, refType: "transfer", refId: id, note: `Transfer #${number}` }, levels, n, "transfer_out", -n.quantity);
          await tx.insert(transferLines).values({ id: newId(), transferId: id, subjectType: n.subjectType, subjectId: n.subjectId, name: names.get(keyOf(n))!.name, quantity: n.quantity, unitCost: r.unitCost });
        }
        await writeAudit(tx, auth, { entityType: "transfer", entityId: id, action: "create", summary: `Transfer #${number}`, changes: { lines: body.lines.length, to: body.toOutletId } });
      });
      const [t] = await db.select().from(transfers).where(eq(transfers.id, id)).limit(1);
      return c.json(await presentTransfer(db, t!, true), 201);
    },
  );

  app.get("/transfers", view, validate("query", paging.extend({ status: z.enum(["in_transit", "received", "cancelled"]).optional() })), async (c) => {
    const { page, pageSize, status } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const ids = (await assignedOutlets(db, auth)).map((o) => o.id);
    if (ids.length === 0) return c.json({ items: [], total: 0, page, pageSize });
    const where = and(eq(transfers.businessId, auth.businessId), or(inArray(transfers.fromOutletId, ids), inArray(transfers.toOutletId, ids)), status ? eq(transfers.status, status) : undefined);
    const rows = await db.select().from(transfers).where(where).orderBy(desc(transfers.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(transfers).where(where);
    return c.json({ items: await Promise.all(rows.map((r) => presentTransfer(db, r, false))), total: total?.n ?? 0, page, pageSize });
  });

  const loadTransfer = async (db: Db, auth: { userId: string; businessId: string }, id: string, side: "from" | "to" | "any") => {
    const [t] = await db.select().from(transfers).where(and(eq(transfers.id, id), eq(transfers.businessId, auth.businessId))).limit(1);
    if (!t) throw new AppError("not_found");
    const mine = (await assignedOutlets(db, auth)).map((o) => o.id);
    const ok = side === "from" ? mine.includes(t.fromOutletId) : side === "to" ? mine.includes(t.toOutletId) : mine.includes(t.fromOutletId) || mine.includes(t.toOutletId);
    if (!ok) throw new AppError("forbidden");
    return t;
  };

  app.get("/transfers/:id", view, validate("param", idParam), async (c) => c.json(await presentTransfer(c.get("db"), await loadTransfer(c.get("db"), c.get("auth"), c.req.valid("param").id, "any"), true)));

  app.post("/transfers/:id/receive", manage, validate("param", idParam), validate("json", z.object({ lines: z.array(z.object({ lineId: uuid, quantity: decimal(0) })).max(200).optional() })), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const t0 = await loadTransfer(db, auth, c.req.valid("param").id, "to");
    const input = c.req.valid("json").lines;
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [tr] = await tx.select().from(transfers).where(eq(transfers.id, t0.id)).limit(1).for("update");
      if (!tr || tr.status !== "in_transit") throw new AppError("conflict", { messageKey: "inventory.transferClosed" });
      const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, tr.id));
      const received = new Map(lines.map((l) => [l.id, l.quantity]));
      if (input) {
        for (const i of input) {
          const l = lines.find((x) => x.id === i.lineId);
          if (!l) throw new AppError("validation", { fields: { lines: "errors.notFound" } });
          const q = toScaled(i.quantity);
          if (q > l.quantity) throw new AppError("validation", { fields: { lines: "inventory.overReceive" } });
          received.set(l.id, q);
        }
      }
      const levels = await lockLevels(tx, tr.toOutletId, lines);
      for (const l of lines) {
        const q = received.get(l.id) ?? 0;
        if (q > 0) await applyMove(tx, { businessId: auth.businessId, outletId: tr.toOutletId, userId: auth.userId, refType: "transfer", refId: tr.id, note: `Transfer #${tr.number}` }, levels, l, "transfer_in", q, l.unitCost);
        await tx.update(transferLines).set({ receivedQty: q }).where(eq(transferLines.id, l.id));
      }
      await tx.update(transfers).set({ status: "received", receivedAt: new Date() }).where(eq(transfers.id, tr.id));
      await writeAudit(tx, auth, { entityType: "transfer", entityId: tr.id, action: "update", summary: `Transfer #${tr.number}`, changes: { received: true, short: lines.filter((l) => (received.get(l.id) ?? 0) < l.quantity).length } });
    });
    const [t] = await db.select().from(transfers).where(eq(transfers.id, t0.id)).limit(1);
    return c.json(await presentTransfer(db, t!, true));
  });

  app.post("/transfers/:id/cancel", manage, validate("param", idParam), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const t0 = await loadTransfer(db, auth, c.req.valid("param").id, "from");
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [tr] = await tx.select().from(transfers).where(eq(transfers.id, t0.id)).limit(1).for("update");
      if (!tr || tr.status !== "in_transit") throw new AppError("conflict", { messageKey: "inventory.transferClosed" });
      const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, tr.id));
      const levels = await lockLevels(tx, tr.fromOutletId, lines);
      for (const l of lines) await applyMove(tx, { businessId: auth.businessId, outletId: tr.fromOutletId, userId: auth.userId, refType: "transfer", refId: tr.id, note: `Transfer #${tr.number}` }, levels, l, "transfer_cancel", l.quantity, l.unitCost);
      await tx.update(transfers).set({ status: "cancelled" }).where(eq(transfers.id, tr.id));
      await writeAudit(tx, auth, { entityType: "transfer", entityId: tr.id, action: "update", summary: `Transfer #${tr.number}`, changes: { cancelled: true } });
    });
    const [t] = await db.select().from(transfers).where(eq(transfers.id, t0.id)).limit(1);
    return c.json(await presentTransfer(db, t!, true));
  });

  // ---------------------------------------------------------------- penyesuaian (stok opname)
  const presentAdjustment = async (db: Db, a: typeof stockAdjustments.$inferSelect, userName?: string) => ({
    id: a.id,
    number: a.number,
    outletId: a.outletId,
    note: a.note,
    valueChange: a.valueChange,
    createdAt: iso(a.createdAt),
    createdBy: userName ?? null,
    lines: a.lines.map((l) => ({ ...l, expected: fromScaled(l.expected), actual: fromScaled(l.actual), delta: fromScaled(l.delta), unitCost: fromScaled(l.unitCost) })),
  });

  app.post(
    "/adjustments",
    manage,
    validate("json", z.object({ outletId: uuid, note: z.string().trim().max(500).nullish(), lines: z.array(subject.extend({ actual: decimal(0), unitCost: decimal(0).optional() })).min(1).max(200).refine(noDuplicates, "Objek ganda") })),
    async (c) => {
      const body = c.req.valid("json");
      const auth = c.get("auth");
      const db = c.get("db");
      await requireOutletAccess(db, auth, body.outletId);
      const names = await resolveSubjects(db, auth.businessId, body.lines);
      const id = newId();
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const levels = await lockLevels(tx, body.outletId, body.lines);
        const number = await nextNumber(tx, body.outletId, "adj");
        const out: (typeof stockAdjustments.$inferSelect)["lines"] = [];
        let total = 0;
        for (const l of body.lines) {
          const cur = levels.get(keyOf(l))!;
          const actual = toScaled(l.actual);
          const delta = actual - cur.quantity;
          let unitCost = cur.avgCost;
          let value = 0;
          if (delta !== 0) {
            const r = await applyMove(tx, { businessId: auth.businessId, outletId: body.outletId, userId: auth.userId, refType: "adjustment", refId: id, note: body.note ?? `Penyesuaian #${number}` }, levels, l, "adjustment", delta, delta > 0 && l.unitCost !== undefined ? toScaled(l.unitCost) : undefined);
            unitCost = r.unitCost;
            value = r.value;
          }
          total += value;
          out.push({ subjectType: l.subjectType, subjectId: l.subjectId, name: names.get(keyOf(l))!.name, expected: cur.quantity, actual, delta, unitCost, value });
        }
        await tx.insert(stockAdjustments).values({ id, businessId: auth.businessId, outletId: body.outletId, number, note: body.note ?? null, valueChange: total, lines: out, createdBy: auth.userId });
        await writeAudit(tx, auth, { entityType: "stock_adjustment", entityId: id, action: "create", summary: `Penyesuaian #${number}`, changes: { lines: out.length, valueChange: total } });
      });
      const [a] = await db.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).limit(1);
      return c.json(await presentAdjustment(db, a!), 201);
    },
  );

  app.get("/adjustments", view, validate("query", paging.extend({ outletId: uuid.optional() })), async (c) => {
    const { page, pageSize, outletId } = c.req.valid("query");
    const auth = c.get("auth");
    const db = c.get("db");
    const ids = await listScope(db, auth, outletId);
    if (ids.length === 0) return c.json({ items: [], total: 0, page, pageSize });
    const where = and(eq(stockAdjustments.businessId, auth.businessId), inArray(stockAdjustments.outletId, ids));
    const rows = await db.select({ a: stockAdjustments, user: users.name }).from(stockAdjustments).innerJoin(users, eq(stockAdjustments.createdBy, users.id)).where(where).orderBy(desc(stockAdjustments.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(stockAdjustments).where(where);
    return c.json({ items: await Promise.all(rows.map((r) => presentAdjustment(db, r.a, r.user))), total: total?.n ?? 0, page, pageSize });
  });

  return app;
};
