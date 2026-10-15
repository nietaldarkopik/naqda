import { and, asc, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  bundleOutlets,
  bundlePrices,
  bundles,
  cashMovements,
  categories,
  counters,
  customers,
  feedback,
  loyaltyRewards,
  itemModifierSets,
  itemOutlets,
  itemVariantPrices,
  itemVariants,
  items,
  modifierOptions,
  modifierSets,
  newId,
  orderActivities,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  payments,
  refundItems,
  refunds,
  roles,
  salesTypes,
  shifts,
  stockLevels,
  tables,
  tableGroups,
  userOutlets,
  users,
  type DbHandle,
} from "@naqdi/db";
import { PaymentError, RefundError, RewardError, itemRewardDiscounts, localMoment, totalRewardDiscount, SplitError, cashDifference, computeRefund, expectedCash, settle, splitLines, splitRefund, type OrderLineInput, type Privilege } from "@naqdi/domain";
import type { PosAuthContext } from "../auth/tokens";
import type { LoginLimiter } from "../auth/limiter";
import type { Config } from "../config";
import { AppError, duplicateKey } from "../errors";
import { iso, validate } from "../http";
import { requireDevice, requirePos, requirePosPrivilege, type PosEnv } from "../pos/context";
import { privilegesOfRole, verifyPin } from "../pos/pin";
import { deductForOrder, restockForRefund } from "../inventory/sales";
import { CodeRejected, enrollCustomer, findCustomer, getProgram, issueCode, loadRewardContext, programActive, recordCodeAttempt, rewardDef, rewardsOf, reverseLoyalty, settleLoyalty } from "../loyalty/service";
import {
  cartSchema,
  fromDiscountInput,
  loadOutletContext,
  loadPromos,
  loadRates,
  loadSalesType,
  outletDiscounts,
  priceLines,
  resolveCart,
  toDiscountInput,
  type OutletContext,
  type PricedOrder,
  type ResolvedLine,
  type StoredDiscount,
} from "../pos/pricing";
import { posAuthRoutes } from "./pos-auth";

type Db = DbHandle["db"];
type OrderRow = typeof orders.$inferSelect;

const idParam = z.object({ id: z.string().uuid() });
const methods = ["cash", "card", "qris", "ewallet", "transfer", "other"] as const;

const conflict = (messageKey: string): never => {
  throw new AppError("conflict", { messageKey });
};

/** Semua rute kasir: /api/v1/pos/... Aktivasi dan login PIN ada di pos-auth.ts; sisanya butuh perangkat + sesi kasir. */
export const posRoutes = (db: Db, config: Config, limiter: LoginLimiter) => {
  const app = new Hono<PosEnv>();
  app.route("/", posAuthRoutes(db, config, limiter));

  const session = new Hono<PosEnv>();
  session.use("*", requireDevice(db), requirePos(db, config));
  session.use("*", requirePosPrivilege("pos.sell"));

  const openShiftOf = async (d: Db, userId: string, outletId: string) =>
    (
      await d
        .select()
        .from(shifts)
        .where(and(eq(shifts.userId, userId), eq(shifts.outletId, outletId), isNull(shifts.closedAt)))
        .limit(1)
    )[0];

  const requireShift = async (d: Db, userId: string, outletId: string) => {
    const s = await openShiftOf(d, userId, outletId);
    if (!s) return conflict("pos.noShift");
    return s;
  };

  const approvalSchema = z.object({ userId: z.string().uuid(), pin: z.string().min(1).max(32) });
  type Approval = z.infer<typeof approvalSchema>;

  /**
   * Hak khusus (batalkan, refund): dimiliki kasir sendiri, atau disetujui atasan yang memasukkan PIN-nya.
   * PIN atasan salah dibalas 403 (bukan 401) agar kasir tidak ikut dikeluarkan dari sesinya.
   */
  const authorize = async (pos: PosAuthContext, privilege: Privilege, approval: Approval | null | undefined): Promise<{ approvedBy: string | null }> => {
    if (pos.privileges.includes(privilege)) return { approvedBy: null };
    if (!approval) throw new AppError("forbidden", { messageKey: "pos.approvalRequired", extra: { required: privilege } });
    try {
      const { user, role } = await verifyPin(db, { businessId: pos.businessId, outletId: pos.outletId }, approval.userId, approval.pin);
      if (!(await privilegesOfRole(db, role.id)).includes(privilege)) throw new AppError("forbidden", { messageKey: "pos.approverNotAllowed" });
      return { approvedBy: user.id };
    } catch (e) {
      if (e instanceof AppError && e.code === "unauthorized") throw new AppError("forbidden", { messageKey: "pos.pinInvalid", extra: { required: privilege } });
      throw e;
    }
  };

  const logActivity = async (tx: Db, pos: PosAuthContext, orderId: string | null, kind: string, detail: Record<string, unknown> | null, approvedBy: string | null = null) => {
    await tx.insert(orderActivities).values({ id: newId(), businessId: pos.businessId, outletId: pos.outletId, orderId, userId: pos.userId, approvedBy, kind, detail });
  };

  const checkTable = async (d: Db, pos: PosAuthContext, tableId: string | null | undefined): Promise<{ id: string; name: string } | null> => {
    if (!tableId) return null;
    const [t] = await d
      .select({ id: tables.id, name: tables.name })
      .from(tables)
      .where(and(eq(tables.id, tableId), eq(tables.businessId, pos.businessId), eq(tables.outletId, pos.outletId), isNull(tables.deletedAt)))
      .limit(1);
    if (!t) throw new AppError("validation", { fields: { tableId: "errors.notFound" } });
    return t;
  };

  // Siapa saja di outlet ini yang boleh menyetujui (punya PIN dan hak yang diminta).
  session.get("/approvers", validate("query", z.object({ privilege: z.enum(["pos.void", "pos.refund", "pos.discount"]) })), async (c) => {
    const pos = c.get("pos");
    const { privilege } = c.req.valid("query");
    const rows = await db
      .select({ id: users.id, name: users.name, roleId: users.roleId })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(userOutlets, and(eq(userOutlets.userId, users.id), eq(userOutlets.outletId, pos.outletId)))
      .where(and(eq(users.businessId, pos.businessId), isNull(users.deletedAt), eq(users.status, "active"), isNotNull(users.pinHash), ne(roles.accessType, "backoffice_only")))
      .orderBy(asc(users.name));
    const cache = new Map<string, boolean>();
    const out: { id: string; name: string }[] = [];
    for (const r of rows) {
      if (!cache.has(r.roleId)) cache.set(r.roleId, (await privilegesOfRole(db, r.roleId)).includes(privilege));
      if (cache.get(r.roleId) && r.id !== pos.userId) out.push({ id: r.id, name: r.name });
    }
    return c.json({ items: out });
  });

  // Denah: meja per grup beserta ringkasan bill terbuka di tiap meja.
  session.get("/tables", async (c) => {
    const pos = c.get("pos");
    const groups = await db
      .select()
      .from(tableGroups)
      .where(and(eq(tableGroups.businessId, pos.businessId), eq(tableGroups.outletId, pos.outletId), isNull(tableGroups.deletedAt)))
      .orderBy(asc(tableGroups.position), asc(tableGroups.name));
    const rows = await db
      .select()
      .from(tables)
      .where(and(eq(tables.businessId, pos.businessId), eq(tables.outletId, pos.outletId), isNull(tables.deletedAt)))
      .orderBy(asc(tables.name));
    const open = await db
      .select({ tableId: orders.tableId, total: orders.total, openedAt: orders.openedAt })
      .from(orders)
      .where(and(eq(orders.businessId, pos.businessId), eq(orders.outletId, pos.outletId), eq(orders.status, "open"), isNotNull(orders.tableId)));
    return c.json({
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      tables: rows.map((t) => {
        const mine = open.filter((o) => o.tableId === t.id);
        return {
          id: t.id,
          name: t.name,
          groupId: t.groupId,
          capacity: t.capacity,
          x: t.x,
          y: t.y,
          shape: t.shape,
          open: mine.length ? { count: mine.length, total: mine.reduce((a, o) => a + o.total, 0), since: iso(mine.map((o) => o.openedAt).sort((a, b) => a.getTime() - b.getTime())[0]!) } : null,
        };
      }),
    });
  });

  // ------------------------------------------------------------------ pelanggan dan loyalty
  const customerView = (c: typeof customers.$inferSelect) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, member: Boolean(c.memberSince), points: c.points });
  const localToday = async (outletId: string) => {
    const [o] = await db.select({ tz: outlets.timezone }).from(outlets).where(eq(outlets.id, outletId)).limit(1);
    return localMoment(new Date(), o?.tz ?? "UTC").date;
  };

  session.get("/customers", validate("query", z.object({ q: z.string().trim().max(60).optional() })), async (c) => {
    const pos = c.get("pos");
    const q = c.req.valid("query").q;
    const term = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null;
    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.businessId, pos.businessId), isNull(customers.deletedAt), term ? or(like(customers.name, term), like(customers.phone, term), like(customers.email, term)) : undefined))
      .orderBy(asc(customers.name))
      .limit(20);
    return c.json({ items: rows.map(customerView) });
  });

  const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
  session.post("/customers", validate("json", z.object({ name: z.string().trim().min(1).max(191), phone: optional(32), email: optional(191), enroll: z.boolean().default(false) })), async (c) => {
    const pos = c.get("pos");
    const body = c.req.valid("json");
    const id = newId();
    try {
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        await tx.insert(customers).values({ id, businessId: pos.businessId, name: body.name, phone: body.phone, email: body.email });
        if (body.enroll) await enrollCustomer(tx, pos.businessId, id, await localToday(pos.outletId), pos.userId);
      });
    } catch (e) {
      if (duplicateKey(e)) throw new AppError("conflict", { fields: { phone: "loyalty.duplicateCustomer" } });
      throw e;
    }
    return c.json({ customer: customerView((await findCustomer(db, pos.businessId, id))!) }, 201);
  });

  session.post("/customers/:id/enroll", validate("param", idParam), async (c) => {
    const pos = c.get("pos");
    const { id } = c.req.valid("param");
    const result = await db.transaction(async (t) => enrollCustomer(t as unknown as Db, pos.businessId, id, await localToday(pos.outletId), pos.userId));
    return c.json({ customer: customerView(result) });
  });

  // Program dan reward yang bisa ditukar sekarang (kosong bila program mati atau di luar masa berlaku).
  session.get("/loyalty", async (c) => {
    const pos = c.get("pos");
    const program = await getProgram(db, pos.businessId);
    if (!programActive(program, await localToday(pos.outletId))) return c.json({ enabled: false, requireCode: false, rewards: [] });
    const rewards = (await rewardsOf(db, pos.businessId)).filter((r) => r.status === "active");
    return c.json({ enabled: true, requireCode: program.requireCode, rewards: rewards.map((r) => ({ id: r.id, name: r.name, pointsCost: r.pointsCost, kind: r.kind, valueKind: r.valueKind, value: r.value, maxDiscount: r.maxDiscount, minPurchase: r.minPurchase })) });
  });

  session.post("/loyalty/code", validate("json", z.object({ customerId: z.string().uuid(), rewardId: z.string().uuid() })), async (c) => {
    const pos = c.get("pos");
    const { customerId, rewardId } = c.req.valid("json");
    const rc = await loadRewardContext(db, pos.businessId, customerId, rewardId, await localToday(pos.outletId));
    const res = await issueCode(db, pos.businessId, rc.customer, rc.reward, !config.isProduction);
    return c.json(res, 201);
  });

  session.post("/feedback", validate("json", z.object({ orderId: z.string().uuid().nullish(), customerId: z.string().uuid().nullish(), rating: z.enum(["good", "bad"]), comment: z.string().trim().max(1000).nullish() })), async (c) => {
    const pos = c.get("pos");
    const body = c.req.valid("json");
    if (body.orderId) {
      const [o] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, body.orderId), eq(orders.businessId, pos.businessId), eq(orders.outletId, pos.outletId))).limit(1);
      if (!o) throw new AppError("validation", { fields: { orderId: "errors.notFound" } });
    }
    if (body.customerId && !(await findCustomer(db, pos.businessId, body.customerId))) throw new AppError("validation", { fields: { customerId: "errors.notFound" } });
    await db.insert(feedback).values({ id: newId(), businessId: pos.businessId, outletId: pos.outletId, orderId: body.orderId ?? null, customerId: body.customerId ?? null, rating: body.rating, comment: body.comment ?? null, createdBy: pos.userId });
    return c.json({ ok: true }, 201);
  });

  // ------------------------------------------------------------------ katalog
  session.get("/catalog", async (c) => {
    const pos = c.get("pos");
    const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
    const [cats, types, discs] = await Promise.all([
      db.select().from(categories).where(and(eq(categories.businessId, pos.businessId), isNull(categories.deletedAt))).orderBy(asc(categories.name)),
      db.select().from(salesTypes).where(and(eq(salesTypes.businessId, pos.businessId), isNull(salesTypes.deletedAt), eq(salesTypes.status, "active"))).orderBy(asc(salesTypes.name)),
      outletDiscounts(db, ctx),
    ]);

    const itemRows = await db
      .select({ item: items })
      .from(items)
      .innerJoin(itemOutlets, and(eq(itemOutlets.itemId, items.id), eq(itemOutlets.outletId, pos.outletId), eq(itemOutlets.available, true)))
      .where(and(eq(items.businessId, pos.businessId), isNull(items.deletedAt), eq(items.status, "active")))
      .orderBy(asc(items.name));
    const itemIds = itemRows.map((r) => r.item.id);
    const variants = itemIds.length
      ? await db.select().from(itemVariants).where(and(inArray(itemVariants.itemId, itemIds), isNull(itemVariants.deletedAt))).orderBy(asc(itemVariants.position), asc(itemVariants.name))
      : [];
    const vIds = variants.map((v) => v.id);
    const vPrices = vIds.length ? await db.select().from(itemVariantPrices).where(inArray(itemVariantPrices.variantId, vIds)) : [];
    const links = itemIds.length ? await db.select().from(itemModifierSets).where(inArray(itemModifierSets.itemId, itemIds)).orderBy(asc(itemModifierSets.position)) : [];
    const setIds = [...new Set(links.map((l) => l.setId))];
    const sets = setIds.length ? await db.select().from(modifierSets).where(and(inArray(modifierSets.id, setIds), isNull(modifierSets.deletedAt))) : [];
    const opts = setIds.length
      ? await db.select().from(modifierOptions).where(and(inArray(modifierOptions.setId, setIds), isNull(modifierOptions.deletedAt))).orderBy(asc(modifierOptions.position))
      : [];

    const bundleRows = await db
      .select({ b: bundles })
      .from(bundles)
      .innerJoin(bundleOutlets, and(eq(bundleOutlets.bundleId, bundles.id), eq(bundleOutlets.outletId, pos.outletId)))
      .where(and(eq(bundles.businessId, pos.businessId), isNull(bundles.deletedAt), eq(bundles.status, "active")))
      .orderBy(asc(bundles.name));
    const bIds = bundleRows.map((r) => r.b.id);
    const bPrices = bIds.length ? await db.select().from(bundlePrices).where(inArray(bundlePrices.bundleId, bIds)) : [];

    const trackedItems = new Set(itemRows.filter((r) => r.item.trackStock).map((r) => r.item.id));
    const stockOf = new Map<string, number>();
    const trackedVariantIds = variants.filter((v) => trackedItems.has(v.itemId)).map((v) => v.id);
    if (trackedVariantIds.length) {
      for (const r of await db
        .select({ id: stockLevels.subjectId, q: stockLevels.quantity })
        .from(stockLevels)
        .where(and(eq(stockLevels.outletId, pos.outletId), eq(stockLevels.subjectType, "variant"), inArray(stockLevels.subjectId, trackedVariantIds)))) stockOf.set(r.id, r.q / 1000);
    }
    const priceMap = (rows: { salesTypeId: string; price: number }[]) => Object.fromEntries(rows.map((r) => [r.salesTypeId, r.price]));
    return c.json({
      stockMode: ctx.stockMode,
      categories: cats.map((x) => ({ id: x.id, name: x.name })),
      salesTypes: types.map((x) => ({ id: x.id, name: x.name })),
      discounts: discs.map((d) => ({ id: d.id, name: d.name, kind: d.kind, value: d.value, scope: d.scope, itemIds: d.itemIds, categoryIds: d.categoryIds, customizable: d.customizable })),
      items: itemRows.map(({ item }) => ({
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        imageUrl: item.imageUrl,
        variants: variants
          .filter((v) => v.itemId === item.id)
          .map((v) => ({ id: v.id, name: v.name, sku: v.sku, basePrice: v.basePrice, prices: priceMap(vPrices.filter((p) => p.variantId === v.id)), stock: trackedItems.has(item.id) ? (stockOf.get(v.id) ?? 0) : null })),
        modifierSets: links
          .filter((l) => l.itemId === item.id)
          .flatMap((l) => {
            const set = sets.find((s) => s.id === l.setId);
            return set
              ? [{ id: set.id, name: set.name, minSelect: set.minSelect, maxSelect: set.maxSelect, options: opts.filter((o) => o.setId === set.id).map((o) => ({ id: o.id, name: o.name, price: o.price })) }]
              : [];
          }),
      })),
      bundles: bundleRows.map(({ b }) => ({ id: b.id, name: b.name, price: b.price, prices: priceMap(bPrices.filter((p) => p.bundleId === b.id)) })),
    });
  });

  // ------------------------------------------------------------------ pesanan: hitung & simpan
  const hasDiscountPrivilege = (c: { get: (k: "pos") => { privileges: string[] } }) => c.get("pos").privileges.includes("pos.discount");

  const priceCart = async (cart: z.infer<typeof cartSchema>, ctx: OutletContext, canDiscount: boolean) => {
    await loadSalesType(db, ctx.businessId, cart.salesTypeId);
    const [resolved, rates, promoDefs] = await Promise.all([resolveCart(db, ctx, cart, canDiscount), loadRates(db, ctx, cart.salesTypeId), loadPromos(db, ctx)]);
    let lines = resolved.lines;
    let orderDiscount = resolved.orderDiscount;
    let reward: { id: string; name: string; pointsCost: number } | null = null;
    let customer: { id: string; name: string } | null = null;
    let preLineDiscount = 0;
    let rewardKind: string | null = null;

    if (cart.customerId) {
      const c = await findCustomer(db, ctx.businessId, cart.customerId);
      if (!c) throw new AppError("validation", { fields: { customerId: "errors.notFound" } });
      customer = { id: c.id, name: c.name };
    }
    if (cart.rewardId) {
      if (!cart.customerId) throw new AppError("validation", { fields: { rewardId: "loyalty.needCustomer" } });
      if (orderDiscount) throw new AppError("validation", { fields: { rewardId: "pos.rewardWithDiscount" } });
      const rc = await loadRewardContext(db, ctx.businessId, cart.customerId, cart.rewardId, localMoment(new Date(), ctx.timezone).date);
      const def = rewardDef(rc.reward);
      try {
        // Nilai setelah diskon baris dan promo: dasar minimum belanja dan reward persen.
        const pre = priceLines(lines, null, ctx, rates, promoDefs, cart.salesTypeId).totals;
        const afterLines = pre.subtotal - pre.lineDiscountTotal - pre.promoDiscountTotal;
        preLineDiscount = pre.lineDiscountTotal;
        rewardKind = def.kind;
        if (def.kind === "item_discount") {
          if (afterLines < def.minPurchase) throw new RewardError("min_purchase", "minimum");
          const found = itemRewardDiscounts(def, lines.map((l) => ({ key: l.key, itemId: l.itemId, categoryId: l.categoryId, unitPrice: l.unitPrice, quantity: l.quantity, hasDiscount: Boolean(l.discount) })));
          lines = lines.map((l) => {
            const d = found.get(l.key);
            return d ? { ...l, discount: d.kind === "percent" ? { kind: "percent" as const, value: d.bp, discountId: null } : { kind: "amount" as const, value: d.amount, discountId: null } } : l;
          });
        } else {
          orderDiscount = { kind: "amount", value: totalRewardDiscount(def, afterLines), discountId: null };
        }
      } catch (e) {
        if (e instanceof RewardError) throw new AppError("validation", { fields: { rewardId: e.code === "min_purchase" ? "loyalty.minPurchase" : "loyalty.notApplicable" } });
        throw e;
      }
      reward = { id: rc.reward.id, name: rc.reward.name, pointsCost: rc.reward.pointsCost };
    }

    const priced = priceLines(lines, orderDiscount, ctx, rates, promoDefs, cart.salesTypeId);
    if (reward) priced.snapshot.reward = { ...reward, discount: rewardKind === "item_discount" ? priced.totals.lineDiscountTotal - preLineDiscount : priced.totals.orderDiscount };
    if (customer) priced.snapshot.customer = customer;
    return { lines, orderDiscount, priced, rates, promoDefs, reward };
  };

  // Pratinjau harga untuk keranjang yang belum disimpan.
  session.post("/price", validate("json", cartSchema), async (c) => {
    const pos = c.get("pos");
    const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
    const r = await priceCart(c.req.valid("json"), ctx, hasDiscountPrivilege(c));
    return c.json({ totals: r.priced.totals, lines: r.lines.map((l, i) => ({ ...l, ...r.priced.totals.lines[i] })), snapshot: r.priced.snapshot });
  });

  const persistLines = async (tx: Db, order: { id: string; businessId: string }, lines: ResolvedLine[], priced: PricedOrder) => {
    const existing = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, order.id));
    if (existing.length) {
      await tx.delete(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, existing.map((e) => e.id)));
      await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
    }
    for (const [i, l] of lines.entries()) {
      const r = priced.totals.lines[i]!;
      const id = newId();
      await tx.insert(orderItems).values({
        id,
        businessId: order.businessId,
        orderId: order.id,
        position: i,
        itemId: l.itemId,
        variantId: l.variantId,
        bundleId: l.bundleId,
        categoryId: l.categoryId,
        name: l.name,
        sku: l.sku,
        unitPrice: l.unitPrice,
        basePrice: l.basePrice,
        cost: l.cost,
        quantity: l.quantity,
        discount: l.discount,
        lineDiscount: r.discount,
        orderDiscountShare: r.orderDiscountShare,
        promoDiscount: r.promoDiscount,
        promoId: r.promoDiscount > 0 ? (priced.promoByLine[l.key] ?? null) : null,
        note: l.note,
      });
      if (l.modifiers.length) {
        await tx.insert(orderItemModifiers).values(l.modifiers.map((m) => ({ id: newId(), orderItemId: id, optionId: m.optionId, name: m.name, price: m.price })));
      }
    }
  };

  const totalsColumns = (t: PricedOrder["totals"]) => ({
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    base: t.base,
    net: t.net,
    gratuity: t.gratuity,
    tax: t.tax,
    rounding: t.rounding,
    total: t.total,
  });

  const lockOrder = async (tx: Db, businessId: string, outletId: string, id: string): Promise<OrderRow> => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.businessId, businessId), eq(orders.outletId, outletId)))
      .limit(1)
      .for("update");
    if (!row) throw new AppError("not_found");
    return row;
  };

  const presentOrder = async (d: Db, o: OrderRow) => {
    const lines = await d.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.position));
    const mods = lines.length ? await d.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, lines.map((l) => l.id))) : [];
    const pays = await d.select().from(payments).where(eq(payments.orderId, o.id)).orderBy(asc(payments.createdAt));
    const cust = o.customerId ? await findCustomer(d, o.businessId, o.customerId) : null;
    const customerView = cust ? { id: cust.id, name: cust.name, points: cust.points, member: Boolean(cust.memberSince) } : null;
    return {
      id: o.id,
      status: o.status,
      receiptNumber: o.receiptNumber,
      salesTypeId: o.salesTypeId,
      tableId: o.tableId,
      customerId: o.customerId,
      customer: customerView,
      rewardId: o.rewardId,
      pointsEarned: o.pointsEarned,
      pointsRedeemed: o.pointsRedeemed,
      refundedTotal: o.refundedTotal,
      label: o.label,
      note: o.note,
      pax: o.pax,
      openedAt: iso(o.openedAt),
      paidAt: iso(o.paidAt),
      voidedAt: iso(o.voidedAt),
      voidReason: o.voidReason,
      orderDiscount: o.orderDiscount,
      snapshot: o.pricingSnapshot,
      totals: {
        subtotal: o.subtotal,
        discountTotal: o.discountTotal,
        base: o.base,
        net: o.net,
        gratuity: o.gratuity,
        tax: o.tax,
        rounding: o.rounding,
        total: o.total,
        paid: o.paidTotal,
        change: o.changeGiven,
      },
      lines: lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        variantId: l.variantId,
        bundleId: l.bundleId,
        name: l.name,
        sku: l.sku,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        refundedQuantity: l.refundedQuantity,
        discount: l.discount,
        lineDiscount: l.lineDiscount,
        orderDiscountShare: l.orderDiscountShare,
        promoDiscount: l.promoDiscount,
        note: l.note,
        modifiers: mods.filter((m) => m.orderItemId === l.id).map((m) => ({ optionId: m.optionId, name: m.name, price: m.price })),
      })),
      payments: pays.map((p) => ({ id: p.id, method: p.method, tendered: p.tendered, applied: p.applied, change: p.change, reference: p.reference, at: iso(p.createdAt) })),
    };
  };

  const lineKey = (variantId: string | null, bundleId: string | null, modifierIds: (string | null)[]) =>
    `${variantId ?? bundleId ?? ""}|${modifierIds.filter(Boolean).sort().join(",")}`;

  session.post("/orders", validate("json", cartSchema), async (c) => {
    const pos = c.get("pos");
    const cart = c.req.valid("json");
    if (cart.lines.length === 0) throw new AppError("validation", { fields: { lines: "pos.emptyOrder" } });
    const shift = await requireShift(db, pos.userId, pos.outletId);
    const table = await checkTable(db, pos, cart.tableId);
    const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
    const r = await priceCart(cart, ctx, hasDiscountPrivilege(c));
    const id = newId();
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      await tx.insert(orders).values({
        id,
        businessId: pos.businessId,
        outletId: pos.outletId,
        shiftId: shift.id,
        userId: pos.userId,
        deviceId: pos.deviceId,
        salesTypeId: cart.salesTypeId,
        tableId: table?.id ?? null,
        customerId: cart.customerId ?? null,
        rewardId: r.reward?.id ?? null,
        label: cart.label ?? null,
        note: cart.note ?? null,
        pax: cart.pax ?? null,
        orderDiscount: r.orderDiscount,
        pricingSnapshot: r.priced.snapshot,
        ...totalsColumns(r.priced.totals),
      });
      await persistLines(tx, { id, businessId: pos.businessId }, r.lines, r.priced);
      await logActivity(tx, pos, id, "bill_created", { total: r.priced.totals.total, lines: r.lines.length, table: table?.name ?? null });
    });
    const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return c.json({ order: await presentOrder(db, row!) }, 201);
  });

  // Mengganti isi bill yang masih terbuka (tambah/ubah/hapus baris). Harga dihitung ulang dari katalog.
  // Mengurangi atau menghapus baris yang SUDAH tersimpan butuh hak pos.void (atau persetujuan atasan) dan alasan.
  session.put(
    "/orders/:id",
    validate("param", idParam),
    validate("json", cartSchema.extend({ reason: z.string().trim().max(255).nullish(), approval: approvalSchema.nullish() })),
    async (c) => {
      const pos = c.get("pos");
      const { id } = c.req.valid("param");
      const { reason, approval, ...cart } = c.req.valid("json");
      if (cart.lines.length === 0) throw new AppError("validation", { fields: { lines: "pos.emptyOrder" } });
      await requireShift(db, pos.userId, pos.outletId);
      const table = await checkTable(db, pos, cart.tableId);
      const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
      const r = await priceCart(cart, ctx, hasDiscountPrivilege(c));

      // Baris tersimpan yang berkurang/hilang dibanding keranjang baru.
      const removedOf = async (d: Db): Promise<{ name: string; quantity: number }[]> => {
        const stored = await d.select().from(orderItems).where(eq(orderItems.orderId, id));
        const mods = stored.length ? await d.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, stored.map((x) => x.id))) : [];
        const want = new Map<string, number>();
        for (const l of cart.lines) {
          const k = l.kind === "item" ? lineKey(l.variantId, null, [...new Set(l.modifierOptionIds)]) : lineKey(null, l.bundleId, []);
          want.set(k, (want.get(k) ?? 0) + l.quantity);
        }
        const have = new Map<string, { name: string; quantity: number }>();
        for (const x of stored) {
          const k = lineKey(x.variantId, x.bundleId, mods.filter((m) => m.orderItemId === x.id).map((m) => m.optionId));
          const cur = have.get(k);
          have.set(k, { name: x.name, quantity: (cur?.quantity ?? 0) + x.quantity });
        }
        const out: { name: string; quantity: number }[] = [];
        for (const [k, v] of have) {
          const diff = v.quantity - (want.get(k) ?? 0);
          if (diff > 0) out.push({ name: v.name, quantity: diff });
        }
        return out;
      };

      let approvedBy: string | null = null;
      let authorized = false;
      if ((await removedOf(db)).length > 0) {
        ({ approvedBy } = await authorize(pos, "pos.void", approval));
        authorized = true;
        if (!reason) throw new AppError("validation", { fields: { reason: "common.required" } });
      }

      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const order = await lockOrder(tx, pos.businessId, pos.outletId, id);
        if (order.status !== "open") return conflict("pos.orderNotOpen");
        const removed = await removedOf(tx);
        if (removed.length > 0 && !authorized) throw new AppError("forbidden", { messageKey: "pos.approvalRequired", extra: { required: "pos.void" } });
        await tx
          .update(orders)
          .set({
            salesTypeId: cart.salesTypeId,
            tableId: table?.id ?? null,
            customerId: cart.customerId ?? null,
            rewardId: r.reward?.id ?? null,
            label: cart.label ?? null,
            note: cart.note ?? null,
            pax: cart.pax ?? null,
            orderDiscount: r.orderDiscount,
            pricingSnapshot: r.priced.snapshot,
            ...totalsColumns(r.priced.totals),
          })
          .where(eq(orders.id, id));
        await persistLines(tx, { id, businessId: pos.businessId }, r.lines, r.priced);
        if (removed.length > 0) await logActivity(tx, pos, id, "item_removed", { items: removed, reason }, approvedBy);
        if ((order.tableId ?? null) !== (table?.id ?? null)) await logActivity(tx, pos, id, "table_changed", { from: order.tableId, to: table?.id ?? null, name: table?.name ?? null });
        await logActivity(tx, pos, id, "bill_updated", { total: r.priced.totals.total, lines: r.lines.length });
      });
      const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      return c.json({ order: await presentOrder(db, row!) });
    },
  );

  session.get(
    "/orders",
    validate("query", z.object({ status: z.enum(["open", "paid", "void"]).default("open"), tableId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })),
    async (c) => {
      const pos = c.get("pos");
      const { status, limit, tableId } = c.req.valid("query");
      const rows = await db
        .select({ o: orders, tableName: tables.name })
        .from(orders)
        .leftJoin(tables, eq(orders.tableId, tables.id))
        .where(and(eq(orders.businessId, pos.businessId), eq(orders.outletId, pos.outletId), eq(orders.status, status), tableId ? eq(orders.tableId, tableId) : undefined))
        .orderBy(desc(orders.openedAt))
        .limit(limit);
      return c.json({
        items: rows.map(({ o, tableName }) => ({
          id: o.id,
          status: o.status,
          receiptNumber: o.receiptNumber,
          label: o.label,
          tableId: o.tableId,
          tableName,
          total: o.total,
          refundedTotal: o.refundedTotal,
          openedAt: iso(o.openedAt),
          paidAt: iso(o.paidAt),
          userId: o.userId,
        })),
      });
    },
  );

  session.get("/orders/:id", validate("param", idParam), async (c) => {
    const pos = c.get("pos");
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, c.req.valid("param").id), eq(orders.businessId, pos.businessId), eq(orders.outletId, pos.outletId)))
      .limit(1);
    if (!row) throw new AppError("not_found");
    return c.json({ order: await presentOrder(db, row) });
  });

  // Membatalkan bill yang belum dibayar: butuh hak pos.void atau persetujuan atasan. Bill lunas dibatalkan lewat refund.
  session.post(
    "/orders/:id/void",
    validate("param", idParam),
    validate("json", z.object({ reason: z.string().trim().min(1).max(255), approval: approvalSchema.nullish() })),
    async (c) => {
      const pos = c.get("pos");
      const { id } = c.req.valid("param");
      const { reason, approval } = c.req.valid("json");
      const { approvedBy } = await authorize(pos, "pos.void", approval);
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const order = await lockOrder(tx, pos.businessId, pos.outletId, id);
        if (order.status !== "open") return conflict("pos.orderNotOpen");
        await tx.update(orders).set({ status: "void", voidedAt: new Date(), voidReason: reason }).where(eq(orders.id, id));
        await logActivity(tx, pos, id, "bill_voided", { reason, total: order.total }, approvedBy);
      });
      const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      return c.json({ order: await presentOrder(db, row!) });
    },
  );

  // Refund bill lunas (sebagian atau seluruhnya): butuh hak pos.refund atau persetujuan atasan, alasan, dan shift terbuka.
  // Uang kembali lewat salah satu metode yang dipakai saat membayar; refund tunai keluar dari laci shift ini.
  session.post(
    "/orders/:id/refund",
    validate("param", idParam),
    validate(
      "json",
      z.object({
        lines: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1) })).min(1).max(200),
        method: z.enum(methods),
        reason: z.string().trim().min(1).max(255),
        restock: z.boolean().default(false),
        approval: approvalSchema.nullish(),
      }),
    ),
    async (c) => {
      const pos = c.get("pos");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const shift = await requireShift(db, pos.userId, pos.outletId);
      const { approvedBy } = await authorize(pos, "pos.refund", body.approval);
      const refundId = newId();

      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const order = await lockOrder(tx, pos.businessId, pos.outletId, id);
        if (order.status !== "paid") return conflict("pos.notPaid");
        const paidWith = await tx.select({ method: payments.method }).from(payments).where(eq(payments.orderId, id));
        if (!paidWith.some((p) => p.method === body.method)) throw new AppError("validation", { fields: { method: "pos.refundMethod" } });

        const rows = await tx.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.position));
        let result;
        try {
          result = computeRefund(
            order.total,
            rows.map((r) => ({
              id: r.id,
              weight: Math.max(0, r.unitPrice * r.quantity - r.lineDiscount - r.promoDiscount - r.orderDiscountShare),
              quantity: r.quantity,
              refundedQuantity: r.refundedQuantity,
            })),
            body.lines,
          );
        } catch (e) {
          if (e instanceof RefundError) throw new AppError("validation", { fields: { lines: "pos.refundInvalid" } });
          throw e;
        }
        if (result.total <= 0) throw new AppError("validation", { fields: { lines: "pos.refundZero" } });
        if (order.refundedTotal + result.total > order.total) throw new AppError("validation", { fields: { lines: "pos.refundInvalid" } });

        if (body.method === "cash") {
          const [s] = await tx.select().from(shifts).where(eq(shifts.id, shift.id)).limit(1).for("update");
          const sum = await shiftSummary(tx, s!);
          if (result.total > (sum.expectedCash ?? 0)) throw new AppError("validation", { fields: { method: "pos.cashShort" } });
        }

        await tx.insert(refunds).values({
          id: refundId,
          businessId: pos.businessId,
          outletId: pos.outletId,
          orderId: id,
          shiftId: shift.id,
          userId: pos.userId,
          approvedBy,
          method: body.method,
          restock: body.restock,
          total: result.total,
          ...(() => {
            const parts = splitRefund(result.total, order);
            return { netAmount: parts.net, gratuityAmount: parts.gratuity, taxAmount: parts.tax };
          })(),
          reason: body.reason,
        });
        for (const l of result.lines) {
          await tx.insert(refundItems).values({ id: newId(), refundId, orderItemId: l.lineId, quantity: l.quantity, amount: l.amount });
          await tx.update(orderItems).set({ refundedQuantity: sql`${orderItems.refundedQuantity} + ${l.quantity}` }).where(eq(orderItems.id, l.lineId));
        }
        await reverseLoyalty(tx, order, result.total, pos.userId);
        if (body.restock) await restockForRefund(tx, { businessId: pos.businessId, outletId: pos.outletId, userId: pos.userId }, refundId, result.lines.map((l) => ({ orderItemId: l.lineId, quantity: l.quantity })));
        await tx.update(orders).set({ refundedTotal: sql`${orders.refundedTotal} + ${result.total}` }).where(eq(orders.id, id));
        await logActivity(tx, pos, id, "refund", { total: result.total, method: body.method, reason: body.reason, lines: result.lines.length }, approvedBy);
      });

      const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      const [rf] = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
      return c.json({ order: await presentOrder(db, row!), refund: { id: refundId, total: rf!.total, method: rf!.method } }, 201);
    },
  );

  // ------------------------------------------------------------------ pembayaran
  session.post(
    "/orders/:id/pay",
    validate("param", idParam),
    validate(
      "json",
      z.object({
        stockOverride: z.boolean().optional(),
        rewardCode: z.string().trim().max(12).nullish(),
        payments: z
          .array(z.object({ method: z.enum(methods), amount: z.number().int().min(1).max(1_000_000_000_000), reference: z.string().trim().max(120).nullish() }))
          .max(10),
      }),
    ),
    async (c) => {
      const pos = c.get("pos");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json").payments;
      const stockOverride = c.req.valid("json").stockOverride === true;
      const rewardCode = c.req.valid("json").rewardCode ?? null;
      const shift = await requireShift(db, pos.userId, pos.outletId);

      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const order = await lockOrder(tx, pos.businessId, pos.outletId, id);
        if (order.status !== "open") return conflict("pos.orderNotOpen");
        const lineCount = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, id)).limit(1);
        if (lineCount.length === 0) throw new AppError("validation", { fields: { lines: "pos.emptyOrder" } });

        let result;
        try {
          result = settle(order.total, input.map((p) => ({ method: p.method, amount: p.amount })));
        } catch (e) {
          if (e instanceof PaymentError) throw new AppError("validation", { fields: { payments: "pos.paymentInvalid" } });
          throw e;
        }
        if (!result.fullyPaid) throw new AppError("validation", { fields: { payments: "pos.paymentShort" } });

        // Nomor struk berurutan tanpa celah: baris penghitung dikunci sampai transaksi selesai.
        await tx
          .insert(counters)
          .values({ outletId: pos.outletId, kind: "receipt", value: 1 })
          .onDuplicateKeyUpdate({ set: { value: sql`${counters.value} + 1` } });
        const [counter] = await tx
          .select({ value: counters.value })
          .from(counters)
          .where(and(eq(counters.outletId, pos.outletId), eq(counters.kind, "receipt")))
          .limit(1);

        await tx
          .update(orders)
          .set({ status: "paid", receiptNumber: counter!.value, paidAt: new Date(), paidTotal: result.paid, changeGiven: result.change })
          .where(eq(orders.id, id));
        await logActivity(tx, pos, id, "paid", { total: order.total, receiptNumber: counter!.value, methods: result.payments.map((p) => p.method) });
        for (const [i, p] of result.payments.entries()) {
          await tx.insert(payments).values({
            id: newId(),
            businessId: pos.businessId,
            orderId: id,
            shiftId: shift.id,
            method: p.method,
            tendered: p.tendered,
            applied: p.applied,
            change: p.change,
            reference: input[i]!.reference ?? null,
            createdBy: pos.userId,
          });
        }
        await deductForOrder(tx, { businessId: pos.businessId, outletId: pos.outletId, userId: pos.userId }, id, stockOverride);
        const loyalty = await settleLoyalty(tx, { ...order, paidAt: new Date() }, rewardCode, pos.userId);
        if (loyalty.earned > 0 || loyalty.redeemed > 0) await tx.update(orders).set({ pointsEarned: loyalty.earned, pointsRedeemed: loyalty.redeemed }).where(eq(orders.id, id));
      }).catch(async (e) => {
        if (e instanceof CodeRejected) {
          await recordCodeAttempt(db, e);
          throw new AppError("conflict", { messageKey: e.key });
        }
        throw e;
      });
      const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      return c.json({ order: await presentOrder(db, row!) });
    },
  );

  // ------------------------------------------------------------------ pisah bill
  session.post(
    "/orders/:id/split",
    validate("param", idParam),
    validate("json", z.object({ selection: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1) })).min(1).max(200) })),
    async (c) => {
      const pos = c.get("pos");
      const { id } = c.req.valid("param");
      const { selection } = c.req.valid("json");
      const shift = await requireShift(db, pos.userId, pos.outletId);
      const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
      let newOrderId = "";

      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const order = await lockOrder(tx, pos.businessId, pos.outletId, id);
        if (order.status !== "open") return conflict("pos.orderNotOpen");

        const rows = await tx.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.position));
        const mods = rows.length ? await tx.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, rows.map((r) => r.id))) : [];
        const resolved = new Map<string, ResolvedLine>(
          rows.map((r) => [
            r.id,
            {
              key: r.id,
              itemId: r.itemId,
              variantId: r.variantId,
              bundleId: r.bundleId,
              categoryId: r.categoryId,
              name: r.name,
              sku: r.sku,
              unitPrice: r.unitPrice,
              basePrice: r.basePrice,
              cost: r.cost,
              quantity: r.quantity,
              discount: r.discount as StoredDiscount | null,
              note: r.note,
              modifiers: mods.filter((m) => m.orderItemId === r.id).map((m) => ({ optionId: m.optionId, name: m.name, price: m.price })),
            },
          ]),
        );
        const inputs: OrderLineInput[] = rows.map((r) => ({ id: r.id, unitPrice: r.unitPrice, quantity: r.quantity, discount: toDiscountInput(r.discount as StoredDiscount | null) }));
        let parts;
        try {
          parts = splitLines(inputs, selection);
        } catch (e) {
          if (e instanceof SplitError) throw new AppError("validation", { fields: { selection: "pos.splitInvalid" } });
          throw e;
        }
        const back = (l: OrderLineInput): ResolvedLine => ({
          ...resolved.get(l.id)!,
          quantity: l.quantity,
          discount: fromDiscountInput(l.discount, (resolved.get(l.id)!.discount as StoredDiscount | null)?.discountId ?? null),
        });
        const keptLines = parts.kept.map(back);
        const movedLines = parts.moved.map(back);

        const [rates, promoDefs] = await Promise.all([loadRates(tx, ctx, order.salesTypeId), loadPromos(tx, ctx)]);
        const keptPriced = priceLines(keptLines, order.orderDiscount, ctx, rates, promoDefs, order.salesTypeId);
        const movedPriced = priceLines(movedLines, null, ctx, rates, promoDefs, order.salesTypeId);

        newOrderId = newId();
        await tx.update(orders).set({ pricingSnapshot: keptPriced.snapshot, ...totalsColumns(keptPriced.totals) }).where(eq(orders.id, id));
        await persistLines(tx, { id, businessId: pos.businessId }, keptLines, keptPriced);
        await tx.insert(orders).values({
          id: newOrderId,
          businessId: pos.businessId,
          outletId: pos.outletId,
          shiftId: shift.id,
          userId: pos.userId,
          deviceId: pos.deviceId,
          salesTypeId: order.salesTypeId,
          tableId: order.tableId,
          label: order.label ? `${order.label} (2)` : null,
          pricingSnapshot: movedPriced.snapshot,
          ...totalsColumns(movedPriced.totals),
        });
        await persistLines(tx, { id: newOrderId, businessId: pos.businessId }, movedLines, movedPriced);
        await logActivity(tx, pos, id, "split", { movedTo: newOrderId, moved: movedLines.length });
      });

      const [a] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      const [b] = await db.select().from(orders).where(eq(orders.id, newOrderId)).limit(1);
      return c.json({ order: await presentOrder(db, a!), moved: await presentOrder(db, b!) }, 201);
    },
  );

  // ------------------------------------------------------------------ shift dan kas
  const shiftSummary = async (d: Db, shiftRow: typeof shifts.$inferSelect) => {
    const [cashRow] = await d
      .select({ total: sql<string>`COALESCE(SUM(${payments.applied}), 0)` })
      .from(payments)
      .where(and(eq(payments.shiftId, shiftRow.id), eq(payments.method, "cash")));
    const [allRow] = await d
      .select({ total: sql<string>`COALESCE(SUM(${payments.applied}), 0)`, n: sql<string>`COUNT(DISTINCT ${payments.orderId})` })
      .from(payments)
      .where(eq(payments.shiftId, shiftRow.id));
    const [refundRow] = await d
      .select({ total: sql<string>`COALESCE(SUM(${refunds.total}), 0)` })
      .from(refunds)
      .where(and(eq(refunds.shiftId, shiftRow.id), eq(refunds.method, "cash")));
    const cashRefunds = Number(refundRow?.total ?? 0);
    const moves = await d.select().from(cashMovements).where(eq(cashMovements.shiftId, shiftRow.id)).orderBy(asc(cashMovements.createdAt));
    const cashIn = moves.filter((m) => m.kind === "in").reduce((a, m) => a + m.amount, 0);
    const cashOut = moves.filter((m) => m.kind === "out").reduce((a, m) => a + m.amount, 0);
    const cashSales = Number(cashRow?.total ?? 0);
    return {
      id: shiftRow.id,
      openedAt: iso(shiftRow.openedAt),
      closedAt: iso(shiftRow.closedAt),
      openingCash: shiftRow.openingCash,
      cashSales,
      cashRefunds,
      nonCashSales: Number(allRow?.total ?? 0) - cashSales,
      orderCount: Number(allRow?.n ?? 0),
      cashIn,
      cashOut,
      expectedCash: shiftRow.closedAt ? shiftRow.expectedCash : expectedCash({ openingCash: shiftRow.openingCash, cashSales, cashRefunds, cashIn, cashOut }),
      actualCash: shiftRow.actualCash,
      difference: shiftRow.difference,
      movements: moves.map((m) => ({ id: m.id, kind: m.kind, amount: m.amount, description: m.description, at: iso(m.createdAt) })),
    };
  };

  session.get("/shifts/current", async (c) => {
    const pos = c.get("pos");
    const s = await openShiftOf(db, pos.userId, pos.outletId);
    return c.json({ shift: s ? await shiftSummary(db, s) : null });
  });

  session.post("/shifts/open", requirePosPrivilege("shift.manage"), validate("json", z.object({ openingCash: z.number().int().min(0).max(1_000_000_000_000) })), async (c) => {
    const pos = c.get("pos");
    const id = newId();
    try {
      await db.insert(shifts).values({ id, businessId: pos.businessId, outletId: pos.outletId, userId: pos.userId, deviceId: pos.deviceId, openingCash: c.req.valid("json").openingCash });
    } catch (e) {
      if (duplicateKey(e)) return conflict("pos.shiftOpen");
      throw e;
    }
    const [s] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
    return c.json({ shift: await shiftSummary(db, s!) }, 201);
  });

  session.post(
    "/shifts/cash",
    requirePosPrivilege("shift.manage"),
    validate("json", z.object({ kind: z.enum(["in", "out"]), amount: z.number().int().min(1).max(1_000_000_000_000), description: z.string().trim().min(1).max(255) })),
    async (c) => {
      const pos = c.get("pos");
      const body = c.req.valid("json");
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const [s] = await tx.select().from(shifts).where(and(eq(shifts.userId, pos.userId), eq(shifts.outletId, pos.outletId), isNull(shifts.closedAt))).limit(1).for("update");
        if (!s) return conflict("pos.noShift");
        if (body.kind === "out") {
          const sum = await shiftSummary(tx, s);
          if (body.amount > (sum.expectedCash ?? 0)) throw new AppError("validation", { fields: { amount: "pos.cashShort" } });
        }
        await tx.insert(cashMovements).values({ id: newId(), businessId: pos.businessId, shiftId: s.id, kind: body.kind, amount: body.amount, description: body.description, createdBy: pos.userId });
      });
      const s = await openShiftOf(db, pos.userId, pos.outletId);
      return c.json({ shift: await shiftSummary(db, s!) }, 201);
    },
  );

  session.post(
    "/shifts/close",
    requirePosPrivilege("shift.manage"),
    validate("json", z.object({ actualCash: z.number().int().min(0).max(1_000_000_000_000), note: z.string().trim().max(500).nullish() })),
    async (c) => {
      const pos = c.get("pos");
      const body = c.req.valid("json");
      let id = "";
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const [s] = await tx.select().from(shifts).where(and(eq(shifts.userId, pos.userId), eq(shifts.outletId, pos.outletId), isNull(shifts.closedAt))).limit(1).for("update");
        if (!s) return conflict("pos.noShift");
        id = s.id;
        const sum = await shiftSummary(tx, s);
        const expected = sum.expectedCash ?? 0;
        await tx
          .update(shifts)
          .set({ closedAt: new Date(), expectedCash: expected, actualCash: body.actualCash, difference: cashDifference(body.actualCash, expected), note: body.note ?? null })
          .where(eq(shifts.id, s.id));
      });
      const [s] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
      return c.json({ shift: await shiftSummary(db, s!) });
    },
  );

  app.route("/", session);
  return app;
};
