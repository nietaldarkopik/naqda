import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  brands,
  businesses,
  cashMovements,
  categories,
  discounts,
  items,
  orderActivities,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  payments,
  promos,
  refunds,
  salesTypes,
  shifts,
  stockMovements,
  tables,
  userOutlets,
  users,
  type DbHandle,
} from "@naqdi/db";
import { addDays, daysBetween, fromScaled, isLocalDate, localMoment, localRangeUtc, toCsv } from "@naqdi/domain";
import { translate } from "@naqdi/i18n";
import { AppError, requestLocale } from "../errors";
import { iso, requirePrivilege, validate, type AppEnv } from "../http";
import { subjectNames } from "./inventory";
import { keyOf } from "../inventory/ledger";
import { loadDataset, RangeTooLarge, windowCondition, chunk, type ReportOutlet, type ReportScope } from "../reports/dataset";
import { charges, collectedBy, daily, discountUsage, groupLines, groupOrders, hourly, paymentMethods, summarize, tableStats, weekday, type Dataset } from "../reports/engine";

type Db = DbHandle["db"];

type ColType = "text" | "int" | "qty" | "money" | "percent" | "datetime" | "minutes";
interface Col {
  key: string;
  type: ColType;
}
type Cell = string | number | null;
interface Tbl {
  columns: Col[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
}

const MAX_DAYS = 366;
const csvLimit = 20_000;

const baseQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  outletIds: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

interface Ctx {
  c: Context<AppEnv>;
  db: Db;
  scope: ReportScope;
  exponent: number;
  currency: string;
}

const todayIn = (tz: string) => localMoment(new Date(), tz).date;

/** Rentang tanggal dan outlet yang boleh dilihat pengguna ini (outlet penugasannya saja). */
const resolveScope = async (c: Context<AppEnv>, db: Db, q: z.infer<typeof baseQuery>): Promise<ReportScope> => {
  const auth = c.get("auth");
  const mine = await db
    .select({ id: outlets.id, name: outlets.name, timezone: outlets.timezone })
    .from(userOutlets)
    .innerJoin(outlets, eq(userOutlets.outletId, outlets.id))
    .where(and(eq(userOutlets.userId, auth.userId), eq(outlets.businessId, auth.businessId), isNull(outlets.deletedAt)))
    .orderBy(asc(outlets.name));
  let chosen: ReportOutlet[] = mine;
  if (q.outletIds) {
    const wanted = q.outletIds.split(",").filter(Boolean);
    chosen = wanted.map((id) => mine.find((o) => o.id === id)).filter((o): o is ReportOutlet => Boolean(o));
    if (chosen.length !== new Set(wanted).size) throw new AppError("forbidden");
  }
  const tz = chosen[0]?.timezone ?? "UTC";
  const to = q.to ?? todayIn(tz);
  const from = q.from ?? addDays(to, -6);
  if (!isLocalDate(from) || !isLocalDate(to)) throw new AppError("validation", { fields: { from: "errors.validation" } });
  if (from > to) throw new AppError("validation", { fields: { from: "reports.rangeOrder" } });
  if (daysBetween(from, to) > MAX_DAYS) throw new AppError("validation", { fields: { from: "reports.rangeTooLong" } });
  return { businessId: auth.businessId, outlets: chosen, from, to };
};

const days = (from: string, to: string): string[] => Array.from({ length: daysBetween(from, to) }, (_, i) => addDays(from, i));

const csvCell = (v: Cell, type: ColType, exponent: number): string | number => {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (type === "money") return exponent === 0 ? v : (v / 10 ** exponent).toFixed(exponent);
  if (type === "percent") return (v / 100).toFixed(2);
  return v;
};

const respond = (x: Ctx, tbl: Tbl, name: string, extra: Record<string, unknown> = {}) => {
  const q = baseQuery.parse(x.c.req.query());
  if (q.format === "csv") {
    const locale = requestLocale(x.c);
    const header = tbl.columns.map((col) => translate(locale, `reports.cols.${col.key}`));
    const body = tbl.rows.map((r) => tbl.columns.map((col) => csvCell(r[col.key] ?? null, col.type, x.exponent)));
    const totals = tbl.totals ? [tbl.columns.map((col, i) => (i === 0 ? translate(locale, "reports.total") : csvCell(tbl.totals![col.key] ?? null, col.type, x.exponent)))] : [];
    return new Response(`﻿${toCsv([header, ...body, ...totals])}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="naqdi-${name}-${x.scope.from}_${x.scope.to}.csv"`,
      },
    });
  }
  return x.c.json({ range: { from: x.scope.from, to: x.scope.to }, outlets: x.scope.outlets.map((o) => ({ id: o.id, name: o.name, timezone: o.timezone })), ...tbl, ...extra });
};

const sumRows = (rows: Record<string, Cell>[], keys: string[]): Record<string, Cell> =>
  Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0)]));

/** Hak reports.view dan akses back office dipasang oleh pemanggil; di sini rentang/outlet dan format. */
export const reportRoutes = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("reports.view"));

  const context = async (c: Context<AppEnv>): Promise<Ctx> => {
    const db = c.get("db");
    const q = baseQuery.safeParse(c.req.query());
    if (!q.success) throw new AppError("validation", { fields: { from: "errors.validation" } });
    const scope = await resolveScope(c, db, q.data);
    const [b] = await db.select({ exponent: businesses.currencyExponent, currency: businesses.currency }).from(businesses).where(eq(businesses.id, scope.businessId)).limit(1);
    return { c, db, scope, exponent: b?.exponent ?? 0, currency: b?.currency ?? "IDR" };
  };

  const withData = async (c: Context<AppEnv>, build: (x: Ctx, ds: Dataset) => Promise<Response> | Response) => {
    const x = await context(c);
    try {
      return await build(x, await loadDataset(x.db, x.scope));
    } catch (e) {
      if (e instanceof RangeTooLarge) throw new AppError("validation", { fields: { from: "reports.rangeTooLarge" } });
      throw e;
    }
  };

  const names = async (db: Db, businessId: string) => {
    const [u, st, cat, br, it, di, pr] = await Promise.all([
      db.select({ id: users.id, name: users.name }).from(users).where(eq(users.businessId, businessId)),
      db.select({ id: salesTypes.id, name: salesTypes.name }).from(salesTypes).where(eq(salesTypes.businessId, businessId)),
      db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.businessId, businessId)),
      db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.businessId, businessId)),
      db.select({ id: items.id, brandId: items.brandId }).from(items).where(eq(items.businessId, businessId)),
      db.select({ id: discounts.id, name: discounts.name }).from(discounts).where(eq(discounts.businessId, businessId)),
      db.select({ id: promos.id, name: promos.name }).from(promos).where(eq(promos.businessId, businessId)),
    ]);
    const m = <T extends { id: string; name: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x.name]));
    return { users: m(u), salesTypes: m(st), categories: m(cat), brands: m(br), itemBrand: new Map(it.map((x) => [x.id, x.brandId])), discounts: m(di), promos: m(pr) };
  };

  // ---------------------------------------------------------------- ringkasan dan dasbor
  app.get("/summary", (c) =>
    withData(c, (x, ds) => {
      const metrics = summarize(ds);
      const rows = Object.entries(metrics).map(([metric, value]) => ({ metric, value }));
      return respond(x, { columns: [{ key: "metric", type: "text" }, { key: "value", type: "int" }], rows }, "summary", { metrics });
    }),
  );

  app.get("/dashboard", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const itemRows = groupLines(ds, (l) => ({ key: `${l.itemId ?? l.bundleId ?? "-"}:${l.name}`, name: l.name })).sort((a, b) => b.netSales - a.netSales);
      const catRows = groupLines(ds, (l) => ({ key: l.categoryId ?? "none", name: l.categoryId ? (n.categories.get(l.categoryId) ?? "-") : "" })).sort((a, b) => b.netSales - a.netSales);
      return x.c.json({
        range: { from: x.scope.from, to: x.scope.to },
        outlets: x.scope.outlets.map((o) => ({ id: o.id, name: o.name, timezone: o.timezone })),
        metrics: summarize(ds),
        daily: daily(ds, days(x.scope.from, x.scope.to)),
        hourly: hourly(ds),
        weekday: weekday(ds),
        topItems: itemRows.slice(0, 10),
        categories: catRows,
        outletComparison: x.scope.outlets.map((o) => ({ outletId: o.id, name: o.name, ...summarize(ds, o.id) })),
        tables: tableStats(ds),
      });
    }),
  );

  app.get("/outlets", (c) =>
    withData(c, (x, ds) => {
      const rows = x.scope.outlets.map((o) => ({ outlet: o.name, ...summarize(ds, o.id) }));
      const cols = ["orders", "grossSales", "discounts", "refunds", "netSales", "gratuity", "tax", "totalCollected", "grossProfit"];
      return respond(
        x,
        { columns: [{ key: "outlet", type: "text" }, ...cols.map((k) => ({ key: k, type: (k === "orders" ? "int" : "money") as ColType }))], rows, totals: sumRows(rows, cols) },
        "outlets",
      );
    }),
  );

  // ---------------------------------------------------------------- penjualan
  app.get("/payments", (c) =>
    withData(c, (x, ds) => {
      const rows = paymentMethods(ds).sort((a, b) => b.net - a.net).map((r) => ({ ...r }));
      return respond(
        x,
        {
          columns: [{ key: "method", type: "text" }, { key: "count", type: "int" }, { key: "collected", type: "money" }, { key: "refunded", type: "money" }, { key: "net", type: "money" }],
          rows,
          totals: sumRows(rows, ["count", "collected", "refunded", "net"]),
        },
        "payments",
      );
    }),
  );

  app.get("/sales-types", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const rows = groupOrders(ds, (o) => o.salesTypeId).map((r) => ({ name: n.salesTypes.get(r.key) ?? "-", ...r })).sort((a, b) => b.netSales - a.netSales);
      const keys = ["orders", "grossSales", "discounts", "netSales", "gratuity", "tax", "total"];
      return respond(x, { columns: [{ key: "name", type: "text" }, ...keys.map((k) => ({ key: k, type: (k === "orders" ? "int" : "money") as ColType }))], rows, totals: sumRows(rows, keys) }, "sales-types");
    }),
  );

  const itemColumns: Col[] = [
    { key: "name", type: "text" },
    { key: "sold", type: "int" },
    { key: "refundedQty", type: "int" },
    { key: "grossSales", type: "money" },
    { key: "discounts", type: "money" },
    { key: "netSales", type: "money" },
    { key: "cogs", type: "money" },
    { key: "grossProfit", type: "money" },
    { key: "refundAmount", type: "money" },
  ];
  const itemKeys = itemColumns.slice(1).map((c) => c.key);

  app.get("/items", (c) =>
    withData(c, (x, ds) => {
      const rows = groupLines(ds, (l) => ({ key: `${l.itemId ?? l.bundleId ?? "-"}:${l.name}`, name: l.name })).sort((a, b) => b.netSales - a.netSales).map((r) => ({ ...r }));
      return respond(x, { columns: itemColumns, rows, totals: sumRows(rows, itemKeys) }, "items");
    }),
  );

  app.get("/categories", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const total = ds.lines.length;
      const rows = groupLines(ds, (l) => ({ key: l.categoryId ?? "none", name: l.categoryId ? (n.categories.get(l.categoryId) ?? "-") : "" }))
        .sort((a, b) => b.netSales - a.netSales)
        .map((r) => ({ ...r }));
      void total;
      const net = rows.reduce((a, r) => a + r.netSales, 0);
      const withShare = rows.map((r) => ({ ...r, share: net > 0 ? Math.round((r.netSales / net) * 10_000) : 0 }));
      return respond(x, { columns: [...itemColumns, { key: "share", type: "percent" }], rows: withShare, totals: sumRows(withShare, itemKeys) }, "categories");
    }),
  );

  app.get("/brands", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const rows = groupLines(ds, (l) => {
        const brandId = l.itemId ? (n.itemBrand.get(l.itemId) ?? null) : null;
        return { key: brandId ?? "none", name: brandId ? (n.brands.get(brandId) ?? "-") : "" };
      })
        .sort((a, b) => b.netSales - a.netSales)
        .map((r) => ({ ...r }));
      return respond(x, { columns: itemColumns, rows, totals: sumRows(rows, itemKeys) }, "brands");
    }),
  );

  app.get("/modifiers", (c) =>
    withData(c, async (x, ds) => {
      const qty = new Map(ds.lines.map((l) => [l.id, l.quantity]));
      const agg = new Map<string, { name: string; quantity: number; revenue: number }>();
      for (const part of chunk([...qty.keys()])) {
        for (const m of await x.db.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, part))) {
          const q = qty.get(m.orderItemId) ?? 0;
          const r = agg.get(m.name) ?? { name: m.name, quantity: 0, revenue: 0 };
          r.quantity += q;
          r.revenue += m.price * q;
          agg.set(m.name, r);
        }
      }
      const rows = [...agg.values()].sort((a, b) => b.revenue - a.revenue).map((r) => ({ ...r }));
      return respond(x, { columns: [{ key: "name", type: "text" }, { key: "quantity", type: "int" }, { key: "revenue", type: "money" }], rows, totals: sumRows(rows, ["quantity", "revenue"]) }, "modifiers");
    }),
  );

  app.get("/discounts", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const rows = discountUsage(ds)
        .map((r) => ({ name: r.type === "manual" ? "" : ((r.type === "promo" ? n.promos : n.discounts).get(r.key) ?? "-"), type: r.type, count: r.count, amount: r.amount }))
        .sort((a, b) => b.amount - a.amount);
      return respond(x, { columns: [{ key: "name", type: "text" }, { key: "type", type: "text" }, { key: "count", type: "int" }, { key: "amount", type: "money" }], rows, totals: sumRows(rows, ["count", "amount"]) }, "discounts");
    }),
  );

  for (const [path, kind] of [["taxes", "taxes"], ["gratuity", "gratuities"]] as const) {
    app.get(`/${path}`, (c) =>
      withData(c, (x, ds) => {
        const rows = charges(ds, kind).sort((a, b) => b.amount - a.amount).map((r) => ({ name: r.name, amount: r.amount }));
        return respond(x, { columns: [{ key: "name", type: "text" }, { key: "amount", type: "money" }], rows, totals: sumRows(rows, ["amount"]) }, path);
      }),
    );
  }

  app.get("/collected-by", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const rows = collectedBy(ds).map((r) => ({ name: n.users.get(r.userId) ?? "-", ...r })).sort((a, b) => b.total - a.total);
      const keys = ["orders", "grossSales", "discounts", "netSales", "total", "refunds"];
      return respond(x, { columns: [{ key: "name", type: "text" }, ...keys.map((k) => ({ key: k, type: (k === "orders" ? "int" : "money") as ColType }))], rows, totals: sumRows(rows, keys) }, "collected-by");
    }),
  );

  // ---------------------------------------------------------------- meja
  app.get("/tables", (c) =>
    withData(c, async (x, ds) => {
      const n = await names(x.db, x.scope.businessId);
      const tableIds = [...new Set(ds.orders.flatMap((o) => (o.tableId ? [o.tableId] : [])))];
      const tn = new Map<string, string>();
      for (const part of chunk(tableIds)) for (const t of await x.db.select({ id: tables.id, name: tables.name }).from(tables).where(inArray(tables.id, part))) tn.set(t.id, t.name);
      const rows = ds.orders
        .filter((o) => o.tableId)
        .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
        .map((o) => ({
          paidAt: o.paidAt.toISOString(),
          receipt: o.receiptNumber,
          table: tn.get(o.tableId!) ?? "-",
          servedBy: n.users.get(o.userId) ?? "-",
          pax: o.pax,
          minutes: Math.round((o.paidAt.getTime() - o.openedAt.getTime()) / 60_000),
          total: o.total,
        }));
      return respond(
        x,
        {
          columns: [{ key: "paidAt", type: "datetime" }, { key: "receipt", type: "int" }, { key: "table", type: "text" }, { key: "servedBy", type: "text" }, { key: "pax", type: "int" }, { key: "minutes", type: "minutes" }, { key: "total", type: "money" }],
          rows,
          totals: sumRows(rows, ["pax", "total"]),
        },
        "tables",
        { stats: tableStats(ds) },
      );
    }),
  );

  // ---------------------------------------------------------------- transaksi
  const txQuery = baseQuery.extend({
    tab: z.enum(["success", "cancelled", "void_items"]).default("success"),
    q: z.string().trim().max(20).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  });

  app.get("/transactions", validate("query", txQuery), async (c) => {
    const x = await context(c);
    const q = c.req.valid("query");
    const csv = q.format === "csv";
    const limit = csv ? csvLimit : q.pageSize;
    const offset = csv ? 0 : (q.page - 1) * q.pageSize;
    const n = await names(x.db, x.scope.businessId);
    const outletName = new Map(x.scope.outlets.map((o) => [o.id, o.name]));

    if (q.tab === "void_items") {
      const approver = alias(users, "approver");
      const cond = and(eq(orderActivities.businessId, x.scope.businessId), eq(orderActivities.kind, "item_removed"), windowCondition(x.scope, orderActivities.outletId, orderActivities.createdAt));
      const rows = await x.db
        .select({ a: orderActivities, approver: approver.name, receipt: orders.receiptNumber })
        .from(orderActivities)
        .leftJoin(approver, eq(orderActivities.approvedBy, approver.id))
        .leftJoin(orders, eq(orderActivities.orderId, orders.id))
        .where(cond)
        .orderBy(desc(orderActivities.createdAt))
        .limit(limit)
        .offset(offset);
      const [cnt] = await x.db.select({ n: sql<string>`COUNT(*)` }).from(orderActivities).where(cond);
      const out = rows.map((r) => {
        const d = (r.a.detail ?? {}) as { items?: { name: string; quantity: number }[]; reason?: string };
        return {
          id: r.a.id,
          at: r.a.createdAt.toISOString(),
          outlet: outletName.get(r.a.outletId) ?? "-",
          receipt: r.receipt,
          user: n.users.get(r.a.userId) ?? "-",
          approvedBy: r.approver,
          items: (d.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(", "),
          reason: d.reason ?? "",
        };
      });
      return respond(
        x,
        { columns: [{ key: "at", type: "datetime" }, { key: "outlet", type: "text" }, { key: "receipt", type: "int" }, { key: "user", type: "text" }, { key: "approvedBy", type: "text" }, { key: "items", type: "text" }, { key: "reason", type: "text" }], rows: out },
        "void-items",
        { total: Number(cnt?.n ?? 0), page: q.page, pageSize: q.pageSize },
      );
    }

    const paid = q.tab === "success";
    const timeCol = paid ? orders.paidAt : orders.voidedAt;
    const cond = and(
      eq(orders.businessId, x.scope.businessId),
      eq(orders.status, paid ? "paid" : "void"),
      windowCondition(x.scope, orders.outletId, timeCol),
      q.q && /^\d+$/.test(q.q) ? eq(orders.receiptNumber, Number(q.q)) : undefined,
    );
    const rows = await x.db
      .select({ o: orders, table: tables.name })
      .from(orders)
      .leftJoin(tables, eq(orders.tableId, tables.id))
      .where(cond)
      .orderBy(desc(timeCol))
      .limit(limit)
      .offset(offset);
    const [cnt] = await x.db.select({ n: sql<string>`COUNT(*)` }).from(orders).where(cond);
    const out = rows.map(({ o, table }) => ({
      id: o.id,
      at: (paid ? o.paidAt : o.voidedAt)?.toISOString() ?? null,
      outlet: outletName.get(o.outletId) ?? "-",
      receipt: o.receiptNumber,
      table,
      servedBy: n.users.get(o.userId) ?? "-",
      salesType: n.salesTypes.get(o.salesTypeId) ?? "-",
      total: o.total,
      refunded: o.refundedTotal,
      reason: o.voidReason ?? "",
    }));
    const cols: Col[] = paid
      ? [{ key: "at", type: "datetime" }, { key: "outlet", type: "text" }, { key: "receipt", type: "int" }, { key: "table", type: "text" }, { key: "servedBy", type: "text" }, { key: "salesType", type: "text" }, { key: "total", type: "money" }, { key: "refunded", type: "money" }]
      : [{ key: "at", type: "datetime" }, { key: "outlet", type: "text" }, { key: "table", type: "text" }, { key: "servedBy", type: "text" }, { key: "total", type: "money" }, { key: "reason", type: "text" }];
    return respond(x, { columns: cols, rows: out }, paid ? "transactions" : "cancelled", { total: Number(cnt?.n ?? 0), page: q.page, pageSize: q.pageSize });
  });

  app.get("/transactions/:id", validate("param", z.object({ id: z.string().uuid() })), async (c) => {
    const x = await context(c);
    const { id } = c.req.valid("param");
    const [o] = await x.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.businessId, x.scope.businessId))).limit(1);
    if (!o || !x.scope.outlets.some((s) => s.id === o.outletId)) throw new AppError("not_found");
    const n = await names(x.db, x.scope.businessId);
    const [lines, pays, refs, acts, table] = await Promise.all([
      x.db.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.position)),
      x.db.select().from(payments).where(eq(payments.orderId, id)).orderBy(asc(payments.createdAt)),
      x.db.select().from(refunds).where(eq(refunds.orderId, id)).orderBy(asc(refunds.createdAt)),
      x.db.select().from(orderActivities).where(eq(orderActivities.orderId, id)).orderBy(asc(orderActivities.createdAt)),
      o.tableId ? x.db.select({ name: tables.name }).from(tables).where(eq(tables.id, o.tableId)).limit(1) : Promise.resolve([]),
    ]);
    const mods = lines.length ? await x.db.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, lines.map((l) => l.id))) : [];
    return c.json({
      order: {
        id: o.id,
        status: o.status,
        receiptNumber: o.receiptNumber,
        openedAt: iso(o.openedAt),
        paidAt: iso(o.paidAt),
        voidedAt: iso(o.voidedAt),
        voidReason: o.voidReason,
        table: table[0]?.name ?? null,
        pax: o.pax,
        servedBy: n.users.get(o.userId) ?? "-",
        salesType: n.salesTypes.get(o.salesTypeId) ?? "-",
        totals: { subtotal: o.subtotal, discountTotal: o.discountTotal, net: o.net, gratuity: o.gratuity, tax: o.tax, rounding: o.rounding, total: o.total, refunded: o.refundedTotal, change: o.changeGiven },
        taxes: (o.pricingSnapshot as { taxes?: unknown } | null)?.taxes ?? [],
        gratuities: (o.pricingSnapshot as { gratuities?: unknown } | null)?.gratuities ?? [],
        lines: lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, refundedQuantity: l.refundedQuantity, unitPrice: l.unitPrice, lineDiscount: l.lineDiscount, promoDiscount: l.promoDiscount, note: l.note, modifiers: mods.filter((m) => m.orderItemId === l.id).map((m) => ({ name: m.name, price: m.price })) })),
        payments: pays.map((p) => ({ method: p.method, tendered: p.tendered, applied: p.applied, change: p.change, reference: p.reference })),
        refunds: refs.map((r) => ({ id: r.id, at: iso(r.createdAt), method: r.method, total: r.total, reason: r.reason, by: n.users.get(r.userId) ?? "-", approvedBy: r.approvedBy ? (n.users.get(r.approvedBy) ?? "-") : null })),
        activities: acts.map((a) => ({ id: a.id, kind: a.kind, at: iso(a.createdAt), by: n.users.get(a.userId) ?? "-", approvedBy: a.approvedBy ? (n.users.get(a.approvedBy) ?? "-") : null, detail: a.detail })),
      },
    });
  });

  // ---------------------------------------------------------------- ringkasan inventori
  app.get("/inventory", async (c) => {
    const x = await context(c);
    type Acc = { type: "variant" | "ingredient"; id: string; beginning: number; purchase: number; sales: number; transfer: number; adjustment: number; production: number; value: number };
    const acc = new Map<string, Acc>();
    const at = (type: "variant" | "ingredient", id: string) => {
      const k = `${type}:${id}`;
      let r = acc.get(k);
      if (!r) acc.set(k, (r = { type, id, beginning: 0, purchase: 0, sales: 0, transfer: 0, adjustment: 0, production: 0, value: 0 }));
      return r;
    };
    for (const o of x.scope.outlets) {
      const r = localRangeUtc(x.scope.from, x.scope.to, o.timezone);
      const before = await x.db
        .select({ type: stockMovements.subjectType, id: stockMovements.subjectId, d: sql<string>`SUM(${stockMovements.delta})`, v: sql<string>`SUM(${stockMovements.value})` })
        .from(stockMovements)
        .where(and(eq(stockMovements.outletId, o.id), lt(stockMovements.createdAt, r.start)))
        .groupBy(stockMovements.subjectType, stockMovements.subjectId);
      for (const b of before) {
        const a = at(b.type, b.id);
        a.beginning += Number(b.d);
        a.value += Number(b.v);
      }
      const within = await x.db
        .select({ type: stockMovements.subjectType, id: stockMovements.subjectId, kind: stockMovements.kind, d: sql<string>`SUM(${stockMovements.delta})`, v: sql<string>`SUM(${stockMovements.value})` })
        .from(stockMovements)
        .where(and(eq(stockMovements.outletId, o.id), gte(stockMovements.createdAt, r.start), lt(stockMovements.createdAt, r.end)))
        .groupBy(stockMovements.subjectType, stockMovements.subjectId, stockMovements.kind);
      for (const w of within) {
        const a = at(w.type, w.id);
        const d = Number(w.d);
        a.value += Number(w.v);
        if (w.kind === "purchase") a.purchase += d;
        else if (w.kind === "sale" || w.kind === "refund") a.sales += d;
        else if (w.kind === "transfer_in" || w.kind === "transfer_out" || w.kind === "transfer_cancel") a.transfer += d;
        else if (w.kind === "adjustment") a.adjustment += d;
        else a.production += d;
      }
    }
    const names = await subjectNames(x.db, x.scope.businessId, [...acc.values()].map((a) => ({ subjectType: a.type, subjectId: a.id })));
    const rows = [...acc.values()]
      .map((a) => {
        const info = names.get(keyOf({ subjectType: a.type, subjectId: a.id }));
        const ending = a.beginning + a.purchase + a.sales + a.transfer + a.adjustment + a.production;
        return { name: info?.name ?? "?", unit: info?.unit ?? "", beginning: fromScaled(a.beginning), purchase: fromScaled(a.purchase), sales: fromScaled(a.sales), transfer: fromScaled(a.transfer), adjustment: fromScaled(a.adjustment), production: fromScaled(a.production), ending: fromScaled(ending), value: a.value, _zero: ending === 0 && a.beginning === 0 && a.purchase === 0 && a.sales === 0 && a.transfer === 0 && a.adjustment === 0 && a.production === 0 };
      })
      .filter((r) => !r._zero)
      .map(({ _zero, ...r }) => r)
      .sort((a, b) => a.name.localeCompare(b.name));
    const qtyKeys = ["beginning", "purchase", "sales", "transfer", "adjustment", "production", "ending"];
    return respond(
      x,
      { columns: [{ key: "name", type: "text" }, { key: "unit", type: "text" }, ...qtyKeys.map((k) => ({ key: k, type: "qty" as ColType })), { key: "value", type: "money" }], rows, totals: sumRows(rows, ["value"]) },
      "inventory",
    );
  });

  // ---------------------------------------------------------------- shift
  app.get("/shifts", async (c) => {
    const x = await context(c);
    const n = await names(x.db, x.scope.businessId);
    const outletName = new Map(x.scope.outlets.map((o) => [o.id, o.name]));
    const rows = await x.db
      .select()
      .from(shifts)
      .where(and(eq(shifts.businessId, x.scope.businessId), windowCondition(x.scope, shifts.outletId, shifts.openedAt)))
      .orderBy(desc(shifts.openedAt))
      .limit(csvLimit);
    const ids = rows.map((r) => r.id);
    const cash = new Map<string, number>();
    const allPay = new Map<string, number>();
    const refundCash = new Map<string, number>();
    const moves = new Map<string, { in: number; out: number }>();
    for (const part of chunk(ids)) {
      for (const p of await x.db.select({ shiftId: payments.shiftId, method: payments.method, s: sql<string>`SUM(${payments.applied})` }).from(payments).where(inArray(payments.shiftId, part)).groupBy(payments.shiftId, payments.method)) {
        allPay.set(p.shiftId, (allPay.get(p.shiftId) ?? 0) + Number(p.s));
        if (p.method === "cash") cash.set(p.shiftId, Number(p.s));
      }
      for (const r of await x.db.select({ shiftId: refunds.shiftId, s: sql<string>`SUM(${refunds.total})` }).from(refunds).where(and(inArray(refunds.shiftId, part), eq(refunds.method, "cash"))).groupBy(refunds.shiftId)) refundCash.set(r.shiftId, Number(r.s));
      for (const m of await x.db.select({ shiftId: cashMovements.shiftId, kind: cashMovements.kind, s: sql<string>`SUM(${cashMovements.amount})` }).from(cashMovements).where(inArray(cashMovements.shiftId, part)).groupBy(cashMovements.shiftId, cashMovements.kind)) {
        const cur = moves.get(m.shiftId) ?? { in: 0, out: 0 };
        cur[m.kind] = Number(m.s);
        moves.set(m.shiftId, cur);
      }
    }
    const out = rows.map((s) => {
      const cashSales = cash.get(s.id) ?? 0;
      const refundsCash = refundCash.get(s.id) ?? 0;
      const mv = moves.get(s.id) ?? { in: 0, out: 0 };
      const expected = s.closedAt ? s.expectedCash : s.openingCash + cashSales - refundsCash + mv.in - mv.out;
      return {
        id: s.id,
        cashier: n.users.get(s.userId) ?? "-",
        outlet: outletName.get(s.outletId) ?? "-",
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        openingCash: s.openingCash,
        cashSales,
        cashRefunds: refundsCash,
        cashIn: mv.in,
        cashOut: mv.out,
        nonCashSales: (allPay.get(s.id) ?? 0) - cashSales,
        expectedCash: expected,
        actualCash: s.actualCash,
        difference: s.difference,
      };
    });
    const keys = ["openingCash", "cashSales", "cashRefunds", "cashIn", "cashOut", "nonCashSales", "expectedCash", "actualCash", "difference"];
    return respond(
      x,
      {
        columns: [{ key: "cashier", type: "text" }, { key: "outlet", type: "text" }, { key: "openedAt", type: "datetime" }, { key: "closedAt", type: "datetime" }, ...keys.map((k) => ({ key: k, type: "money" as ColType }))],
        rows: out,
        totals: sumRows(out, keys),
      },
      "shifts",
    );
  });

  return app;
};
