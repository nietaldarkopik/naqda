import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  bundles,
  counters,
  itemVariants,
  items,
  modifierOptions,
  modifierSets,
  newId,
  orders,
  payments,
  roles,
  salesTypes,
  shifts,
  userOutlets,
  users,
  type DbHandle,
} from "@naqdi/db";
import {
  PaymentError,
  computeOrder,
  isPrivilege,
  priceLines,
  promoToWire,
  settle,
  toDiscountInput,
  type OrderTotals,
  type PricingPack,
  type ResolvedLine,
  type StoredDiscount,
} from "@naqdi/domain";
import type { SaleOp, SyncResult } from "@naqdi/sync";
import { AppError, duplicateKey } from "../errors";
import { validate } from "../http";
import { buildCostModel } from "../inventory/recipes";
import { deductForOrder } from "../inventory/sales";
import { authQueries } from "../repo/tenant";
import type { PosAuthContext } from "../auth/tokens";
import type { PosEnv } from "./context";
import { logActivity, persistLines, totalsColumns } from "./orders";
import { loadOutletContext, loadPromos, loadRates, resolveCart } from "./pricing";

type Db = DbHandle["db"];

/** Penjualan offline lebih tua dari ini, atau lebih maju dari jam server, dicatat dengan waktu server dan diberi tanda. */
const MAX_AGE_MS = 30 * 24 * 3_600_000;
const MAX_FUTURE_MS = 5 * 60_000;

const uuid = z.string().uuid();
const money = z.number().int().min(0).max(1_000_000_000_000);
const storedDiscount = z.object({ kind: z.enum(["percent", "amount"]), value: money, discountId: uuid.nullish() });
const rate = z.object({ id: z.string().max(64), name: z.string().max(191), rateBp: z.number().int().min(0).max(10_000) });

const saleOpSchema = z.object({
  type: z.literal("sale"),
  clientId: uuid,
  createdAt: z.iso.datetime({ offset: true }),
  clientRef: z.string().trim().min(1).max(40),
  userId: uuid,
  shiftId: uuid,
  salesTypeId: uuid,
  label: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        itemId: uuid.nullable(),
        variantId: uuid.nullable(),
        bundleId: uuid.nullable(),
        categoryId: uuid.nullable(),
        promoId: uuid.nullable(),
        name: z.string().trim().min(1).max(255),
        sku: z.string().max(64).nullable(),
        unitPrice: money,
        basePrice: money,
        quantity: z.number().int().min(1).max(9999),
        discount: storedDiscount.nullable(),
        promoDiscount: money,
        note: z.string().trim().max(255).nullable(),
        modifiers: z.array(z.object({ optionId: uuid.nullable(), name: z.string().max(191), price: money })).max(50),
      }),
    )
    .min(1)
    .max(200),
  orderDiscount: storedDiscount.nullable(),
  taxes: z.array(rate).max(20),
  gratuities: z.array(rate).max(20),
  settings: z.object({
    pricesIncludeTax: z.boolean(),
    pricesIncludeGratuity: z.boolean(),
    taxOnGratuity: z.boolean(),
    roundingStep: z.number().int().min(0).max(1_000_000),
    roundingMode: z.enum(["nearest", "up", "down"]),
    discountMode: z.enum(["sequential", "stack", "exclusive"]).optional(),
  }),
  total: money,
  payments: z
    .array(z.object({ method: z.string().trim().min(1).max(24), amount: z.number().int().min(1).max(1_000_000_000_000), reference: z.string().trim().max(120).nullish() }))
    .min(1)
    .max(10),
});

const reject = (clientId: string, code: string, message: string, retryable = false): SyncResult => ({ clientId, status: "rejected", code, message, retryable });

/** Penjualan yang dibuat offline: kasir sudah menerima uang, jadi server mencatatnya apa adanya dan menandai selisih untuk ditinjau. */
export const syncRoutes = (db: Db) => {
  const app = new Hono<PosEnv>();

  // Data harga outlet (tarif, pengaturan, promo) untuk dihitung di perangkat bersama katalog dari /catalog.
  app.get("/pricing-pack", async (c) => {
    const pos = c.get("pos");
    const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
    const types = await db
      .select({ id: salesTypes.id })
      .from(salesTypes)
      .where(and(eq(salesTypes.businessId, pos.businessId), isNull(salesTypes.deletedAt), eq(salesTypes.status, "active")))
      .orderBy(asc(salesTypes.name));
    const gratuitiesBySalesType: PricingPack["gratuitiesBySalesType"] = {};
    let taxes: PricingPack["taxes"] = [];
    for (const t of types) {
      const rates = await loadRates(db, ctx, t.id);
      taxes = rates.taxes;
      gratuitiesBySalesType[t.id] = rates.gratuities;
    }
    if (types.length === 0) taxes = (await loadRates(db, ctx, newId())).taxes;
    const pack: PricingPack = {
      outletId: pos.outletId,
      timezone: ctx.timezone,
      settings: ctx.settings,
      taxes,
      gratuitiesBySalesType,
      promos: (await loadPromos(db, ctx)).map(promoToWire),
      serverTime: new Date().toISOString(),
    };
    return c.json(pack);
  });

  const processSale = async (pos: PosAuthContext, op: SaleOp): Promise<SyncResult> => {
    const id = op.clientId;

    // Idempoten: order dengan id ini sudah ada berarti operasi pernah diterima.
    const [existing] = await db.select({ businessId: orders.businessId, outletId: orders.outletId, status: orders.status, receiptNumber: orders.receiptNumber }).from(orders).where(eq(orders.id, id)).limit(1);
    if (existing) {
      if (existing.businessId !== pos.businessId || existing.outletId !== pos.outletId) return reject(id, "conflict", "id sudah dipakai");
      return { clientId: id, status: "duplicate", orderId: id, receiptNumber: existing.receiptNumber };
    }

    // Pelaku: kasir yang menjual (bisa berbeda dari kasir yang sedang menyinkronkan), harus sah di outlet ini.
    const [actor] = await db
      .select({ id: users.id, roleId: users.roleId, accessType: roles.accessType })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(userOutlets, and(eq(userOutlets.userId, users.id), eq(userOutlets.outletId, pos.outletId)))
      .where(and(eq(users.id, op.userId), eq(users.businessId, pos.businessId), isNull(users.deletedAt), eq(users.status, "active")))
      .limit(1);
    if (!actor || actor.accessType === "backoffice_only") return reject(id, "invalid_user", "kasir tidak sah di outlet ini");
    const privileges = (await authQueries(db).privilegesOf(actor.roleId)).filter(isPrivilege);
    if (!privileges.includes("pos.sell")) return reject(id, "forbidden", "kasir tidak berhak menjual");
    const usesDiscount = Boolean(op.orderDiscount) || op.lines.some((l) => l.discount);
    if (usesDiscount && !privileges.includes("pos.discount")) return reject(id, "forbidden_discount", "kasir tidak berhak memberi diskon");

    // Shift: shift yang tercatat di operasi bila masih terbuka, kalau tidak shift terbuka kasir itu saat ini.
    const [recorded] = await db.select().from(shifts).where(and(eq(shifts.id, op.shiftId), eq(shifts.businessId, pos.businessId), eq(shifts.outletId, pos.outletId), eq(shifts.userId, actor.id))).limit(1);
    let shift = recorded && !recorded.closedAt ? recorded : undefined;
    if (!shift) {
      [shift] = await db.select().from(shifts).where(and(eq(shifts.userId, actor.id), eq(shifts.outletId, pos.outletId), isNull(shifts.closedAt))).limit(1);
    }
    if (!shift) return reject(id, "no_shift", "tidak ada shift terbuka untuk kasir ini", true);

    const [salesType] = await db
      .select({ id: salesTypes.id })
      .from(salesTypes)
      .where(and(eq(salesTypes.id, op.salesTypeId), eq(salesTypes.businessId, pos.businessId), isNull(salesTypes.deletedAt)))
      .limit(1);
    if (!salesType) return reject(id, "invalid_items", "tipe penjualan tidak dikenal");

    // Id katalog harus milik bisnis ini; id item/kategori diambil dari katalog, bukan dari perangkat.
    const variantIds = [...new Set(op.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
    const bundleIds = [...new Set(op.lines.flatMap((l) => (l.bundleId ? [l.bundleId] : [])))];
    const optionIds = [...new Set(op.lines.flatMap((l) => l.modifiers.flatMap((m) => (m.optionId ? [m.optionId] : []))))];
    if (op.lines.some((l) => Boolean(l.variantId) === Boolean(l.bundleId))) return reject(id, "invalid_items", "baris harus berupa item atau paket");
    const variantRows = variantIds.length
      ? await db
          .select({ id: itemVariants.id, cost: itemVariants.cost, sku: itemVariants.sku, itemId: items.id, categoryId: items.categoryId })
          .from(itemVariants)
          .innerJoin(items, eq(itemVariants.itemId, items.id))
          .where(and(inArray(itemVariants.id, variantIds), eq(itemVariants.businessId, pos.businessId)))
      : [];
    const bundleRows = bundleIds.length ? await db.select({ id: bundles.id }).from(bundles).where(and(inArray(bundles.id, bundleIds), eq(bundles.businessId, pos.businessId))) : [];
    const optionRows = optionIds.length
      ? await db
          .select({ id: modifierOptions.id })
          .from(modifierOptions)
          .innerJoin(modifierSets, eq(modifierOptions.setId, modifierSets.id))
          .where(and(inArray(modifierOptions.id, optionIds), eq(modifierSets.businessId, pos.businessId)))
      : [];
    if (variantRows.length !== variantIds.length || bundleRows.length !== bundleIds.length || optionRows.length !== optionIds.length) {
      return reject(id, "invalid_items", "item, paket, atau modifier tidak dikenal");
    }
    const variantById = new Map(variantRows.map((v) => [v.id, v]));

    // Total dihitung ulang dari masukan perangkat dengan kode domain yang sama; hasilnya harus sama dengan yang dilihat kasir.
    let totals: OrderTotals;
    try {
      totals = computeOrder({
        lines: op.lines.map((l, i) => ({ id: String(i), unitPrice: l.unitPrice, quantity: l.quantity, discount: toDiscountInput(l.discount), promoDiscount: l.promoDiscount })),
        orderDiscount: toDiscountInput(op.orderDiscount),
        taxRatesBp: op.taxes.map((t) => t.rateBp),
        gratuityRatesBp: op.gratuities.map((g) => g.rateBp),
        settings: op.settings,
      });
    } catch (e) {
      if (e instanceof RangeError) return reject(id, "inconsistent_quote", e.message);
      throw e;
    }
    if (totals.total !== op.total) return reject(id, "inconsistent_quote", `total ${op.total} tidak cocok dengan hitungan ${totals.total}`);

    let settlement;
    try {
      settlement = settle(totals.total, op.payments.map((p) => ({ method: p.method, amount: p.amount })));
    } catch (e) {
      if (e instanceof PaymentError) return reject(id, "payment_invalid", e.message);
      throw e;
    }
    if (!settlement.fullyPaid) return reject(id, "payment_short", "pembayaran kurang dari total");

    const flags: string[] = [];
    const now = Date.now();
    let at = new Date(op.createdAt);
    if (at.getTime() > now + MAX_FUTURE_MS || at.getTime() < now - MAX_AGE_MS) {
      flags.push("clock_skew");
      at = new Date(now);
    }

    // Pendapat server: harga katalog sekarang untuk keranjang yang sama. Selisih hanya ditandai, tidak mengubah transaksi.
    const ctx = await loadOutletContext(db, pos.businessId, pos.outletId);
    try {
      const cart = {
        salesTypeId: op.salesTypeId,
        lines: op.lines.map((l) =>
          l.bundleId
            ? { kind: "bundle" as const, bundleId: l.bundleId, quantity: l.quantity, note: l.note, discount: l.discount?.discountId ? { discountId: l.discount.discountId, value: l.discount.value } : null }
            : { kind: "item" as const, variantId: l.variantId!, quantity: l.quantity, modifierOptionIds: l.modifiers.flatMap((m) => (m.optionId ? [m.optionId] : [])), note: l.note, discount: l.discount?.discountId ? { discountId: l.discount.discountId, value: l.discount.value } : null },
        ),
        orderDiscount: op.orderDiscount?.discountId ? { discountId: op.orderDiscount.discountId, value: op.orderDiscount.value } : null,
      };
      const [resolved, rates, promoDefs] = await Promise.all([resolveCart(db, ctx, cart, true), loadRates(db, ctx, op.salesTypeId), loadPromos(db, ctx)]);
      const server = priceLines(resolved.lines, resolved.orderDiscount, ctx, rates, promoDefs, op.salesTypeId, at);
      if (server.totals.total !== totals.total) flags.push("price_mismatch");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      flags.push("price_unverified");
    }

    const model = await buildCostModel(db, pos.outletId, { variantIds, optionIds, bundleIds });
    const lines: ResolvedLine[] = op.lines.map((l, i) => {
      const v = l.variantId ? variantById.get(l.variantId) : undefined;
      return {
        key: String(i),
        itemId: v?.itemId ?? null,
        variantId: l.variantId,
        bundleId: l.bundleId,
        categoryId: v?.categoryId ?? null,
        name: l.name,
        sku: l.sku ?? v?.sku ?? null,
        unitPrice: l.unitPrice,
        basePrice: l.basePrice,
        cost: model.unitCost({ variantId: l.variantId, bundleId: l.bundleId, optionIds: l.modifiers.map((m) => m.optionId), manualCost: v?.cost ?? 0 }),
        quantity: l.quantity,
        discount: l.discount as StoredDiscount | null,
        note: l.note,
        modifiers: l.modifiers,
      };
    });
    const promoByLine: Record<string, string> = {};
    op.lines.forEach((l, i) => {
      if (l.promoId && l.promoDiscount > 0) promoByLine[String(i)] = l.promoId;
    });
    const priced = {
      totals,
      promoByLine,
      snapshot: {
        settings: op.settings,
        taxes: op.taxes.map((t, i) => ({ ...t, amount: totals.taxPerRate[i] ?? 0 })),
        gratuities: op.gratuities.map((g, i) => ({ ...g, amount: totals.gratuityPerRate[i] ?? 0 })),
        promos: [],
        computedAt: op.createdAt,
        offline: { clientRef: op.clientRef },
      },
    };

    let receiptNumber = 0;
    let shortStock = 0;
    try {
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        // Nomor struk berurutan tanpa celah: bila transaksi gagal, kenaikan penghitung ikut dibatalkan.
        await tx
          .insert(counters)
          .values({ outletId: pos.outletId, kind: "receipt", value: 1 })
          .onDuplicateKeyUpdate({ set: { value: sql`${counters.value} + 1` } });
        const [counter] = await tx.select({ value: counters.value }).from(counters).where(and(eq(counters.outletId, pos.outletId), eq(counters.kind, "receipt"))).limit(1);
        receiptNumber = counter!.value;

        await tx.insert(orders).values({
          id,
          businessId: pos.businessId,
          outletId: pos.outletId,
          shiftId: shift.id,
          userId: actor.id,
          deviceId: pos.deviceId,
          salesTypeId: op.salesTypeId,
          label: op.label ?? null,
          note: op.note ?? null,
          status: "paid",
          receiptNumber,
          openedAt: at,
          paidAt: at,
          orderDiscount: op.orderDiscount,
          pricingSnapshot: priced.snapshot,
          paidTotal: settlement.paid,
          changeGiven: settlement.change,
          ...totalsColumns(totals),
        });
        await persistLines(tx, { id, businessId: pos.businessId }, lines, priced);
        for (const [i, p] of settlement.payments.entries()) {
          await tx.insert(payments).values({
            id: newId(),
            businessId: pos.businessId,
            orderId: id,
            shiftId: shift.id,
            method: p.method,
            tendered: p.tendered,
            applied: p.applied,
            change: p.change,
            reference: op.payments[i]!.reference ?? null,
            createdBy: actor.id,
            createdAt: at,
          });
        }
        shortStock = await deductForOrder(tx, { businessId: pos.businessId, outletId: pos.outletId, userId: actor.id }, id, true, true);
        if (shortStock > 0) flags.push("stock_negative");
        const detail = { total: totals.total, receiptNumber, methods: settlement.payments.map((p) => p.method), offline: { clientRef: op.clientRef, at: op.createdAt, syncedBy: pos.userId, flags } };
        await logActivity(tx, { businessId: pos.businessId, outletId: pos.outletId, userId: actor.id }, id, "paid", detail);
        if (flags.length > 0) await logActivity(tx, { businessId: pos.businessId, outletId: pos.outletId, userId: actor.id }, id, "sync_review", { clientRef: op.clientRef, flags, total: totals.total });
      });
    } catch (e) {
      // Dua pengiriman bersamaan untuk id yang sama: yang kalah berarti sudah ada.
      if (duplicateKey(e) !== null) {
        const [now2] = await db.select({ receiptNumber: orders.receiptNumber, businessId: orders.businessId }).from(orders).where(eq(orders.id, id)).limit(1);
        if (now2 && now2.businessId === pos.businessId) return { clientId: id, status: "duplicate", orderId: id, receiptNumber: now2.receiptNumber };
      }
      throw e;
    }
    return { clientId: id, status: "created", orderId: id, receiptNumber, flags };
  };

  app.post("/sync", validate("json", z.object({ ops: z.array(z.unknown()).min(1).max(50) })), async (c) => {
    const pos = c.get("pos");
    const results: SyncResult[] = [];
    for (const raw of c.req.valid("json").ops) {
      const parsed = saleOpSchema.safeParse(raw);
      if (!parsed.success) {
        const clientId = typeof (raw as { clientId?: unknown })?.clientId === "string" ? (raw as { clientId: string }).clientId : null;
        if (clientId) results.push(reject(clientId, "invalid", parsed.error.issues[0]?.message ?? "operasi tidak valid"));
        continue;
      }
      try {
        results.push(await processSale(pos, parsed.data as SaleOp));
      } catch (e) {
        console.error("[sync] galat tidak tertangani:", e);
        results.push(reject(parsed.data.clientId, "server", "galat server", true));
      }
    }
    return c.json({ results });
  });

  return app;
};
