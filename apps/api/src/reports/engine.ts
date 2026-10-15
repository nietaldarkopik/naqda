import { allocateProportional, type LocalMoment } from "@naqdi/domain";

/**
 * Mesin agregasi laporan: murni (tanpa DB), menerima data penjualan yang sudah dimuat. Definisi angka ada di
 * packages/domain/src/report.ts dan doc 02 bagian 8.
 */

export interface SaleOrder {
  id: string;
  outletId: string;
  userId: string;
  salesTypeId: string;
  tableId: string | null;
  pax: number | null;
  receiptNumber: number | null;
  openedAt: Date;
  paidAt: Date;
  subtotal: number;
  discountTotal: number;
  base: number;
  net: number;
  gratuity: number;
  tax: number;
  rounding: number;
  total: number;
  orderDiscount: { kind: string; value: number; discountId?: string | null } | null;
  snapshot: { taxes?: { id?: string; name: string; amount: number }[]; gratuities?: { id?: string; name: string; amount: number }[] } | null;
  local: LocalMoment;
}

export interface SaleLine {
  id: string;
  orderId: string;
  itemId: string | null;
  categoryId: string | null;
  bundleId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  lineDiscount: number;
  promoDiscount: number;
  orderDiscountShare: number;
  discount: { discountId?: string | null } | null;
  promoId: string | null;
}

export interface SalePayment {
  orderId: string;
  method: string;
  applied: number;
}

export interface RefundRec {
  id: string;
  orderId: string;
  outletId: string;
  userId: string;
  method: string;
  total: number;
  net: number;
  gratuity: number;
  tax: number;
  createdAt: Date;
  local: LocalMoment;
}

export interface RefundLineRec {
  refundId: string;
  /** Baris asal (boleh dari pesanan di luar rentang). */
  line: SaleLine;
  quantity: number;
  amount: number;
}

export interface Dataset {
  orders: SaleOrder[];
  lines: SaleLine[];
  payments: SalePayment[];
  refunds: RefundRec[];
  refundLines: RefundLineRec[];
}

const sum = <T>(xs: readonly T[], f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);

export interface Metrics {
  orders: number;
  itemsSold: number;
  grossSales: number;
  discounts: number;
  includedCharges: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  gratuity: number;
  tax: number;
  rounding: number;
  totalCollected: number;
  refundsTotal: number;
  averageOrder: number;
}

/** Ringkasan penjualan. `filter` membatasi pesanan (dan refund-nya) mis. per outlet. */
export const summarize = (ds: Dataset, outletId?: string): Metrics => {
  const orders = outletId ? ds.orders.filter((o) => o.outletId === outletId) : ds.orders;
  const refunds = outletId ? ds.refunds.filter((r) => r.outletId === outletId) : ds.refunds;
  const ids = new Set(orders.map((o) => o.id));
  const lines = ds.lines.filter((l) => ids.has(l.orderId));
  const refundIds = new Set(refunds.map((r) => r.id));
  const refundLines = ds.refundLines.filter((r) => refundIds.has(r.refundId));

  const grossSales = sum(orders, (o) => o.subtotal);
  const discounts = sum(orders, (o) => o.discountTotal);
  const includedCharges = sum(orders, (o) => o.base - o.net);
  const refundsNet = sum(refunds, (r) => r.net);
  const netSales = sum(orders, (o) => o.net) - refundsNet;
  const cogs = sum(lines, (l) => l.cost * l.quantity) - sum(refundLines, (r) => r.line.cost * r.quantity);
  const totalCollected = sum(orders, (o) => o.total) - sum(refunds, (r) => r.total);
  return {
    orders: orders.length,
    itemsSold: sum(lines, (l) => l.quantity) - sum(refundLines, (r) => r.quantity),
    grossSales,
    discounts,
    includedCharges,
    refunds: refundsNet,
    netSales,
    cogs,
    grossProfit: netSales - cogs,
    gratuity: sum(orders, (o) => o.gratuity) - sum(refunds, (r) => r.gratuity),
    tax: sum(orders, (o) => o.tax) - sum(refunds, (r) => r.tax),
    rounding: sum(orders, (o) => o.rounding),
    totalCollected,
    refundsTotal: sum(refunds, (r) => r.total),
    averageOrder: orders.length ? Math.round(sum(orders, (o) => o.total) / orders.length) : 0,
  };
};

export interface Bucket {
  key: string;
  orders: number;
  grossSales: number;
  discounts: number;
  netSales: number;
}

const bucketBy = (ds: Dataset, keyOf: (m: { local: LocalMoment }) => string): Map<string, Bucket> => {
  const out = new Map<string, Bucket>();
  const at = (key: string) => {
    let b = out.get(key);
    if (!b) out.set(key, (b = { key, orders: 0, grossSales: 0, discounts: 0, netSales: 0 }));
    return b;
  };
  for (const o of ds.orders) {
    const b = at(keyOf(o));
    b.orders += 1;
    b.grossSales += o.subtotal;
    b.discounts += o.discountTotal;
    b.netSales += o.net;
  }
  for (const r of ds.refunds) at(keyOf(r)).netSales -= r.net; // refund dihitung pada hari refund
  return out;
};

/** Penjualan per hari (urut tanggal); hari tanpa transaksi diisi nol agar grafik tidak bolong. */
export const daily = (ds: Dataset, days: string[]): Bucket[] => {
  const b = bucketBy(ds, (m) => m.local.date);
  return days.map((d) => b.get(d) ?? { key: d, orders: 0, grossSales: 0, discounts: 0, netSales: 0 });
};
export const hourly = (ds: Dataset): Bucket[] => {
  const b = bucketBy(ds, (m) => String(m.local.hour));
  return Array.from({ length: 24 }, (_, h) => b.get(String(h)) ?? { key: String(h), orders: 0, grossSales: 0, discounts: 0, netSales: 0 });
};
export const weekday = (ds: Dataset): Bucket[] => {
  const b = bucketBy(ds, (m) => String(m.local.weekday));
  return Array.from({ length: 7 }, (_, d) => b.get(String(d)) ?? { key: String(d), orders: 0, grossSales: 0, discounts: 0, netSales: 0 });
};

/** Nilai barang (net) tiap baris: net pesanan dibagi sebanding harga baris setelah semua diskon; jumlah tepat. */
export const lineNets = (ds: Dataset): Map<string, number> => {
  const byOrder = new Map<string, SaleLine[]>();
  for (const l of ds.lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);
  const orders = new Map(ds.orders.map((o) => [o.id, o]));
  const out = new Map<string, number>();
  for (const [orderId, lines] of byOrder) {
    const o = orders.get(orderId);
    if (!o) continue;
    const weights = lines.map((l) => Math.max(0, l.unitPrice * l.quantity - l.lineDiscount - l.promoDiscount - l.orderDiscountShare));
    const shares = allocateProportional(o.net, weights);
    lines.forEach((l, i) => out.set(l.id, shares[i]!));
  }
  return out;
};

/** Bagian nilai barang (net) dari tiap baris refund: net refund dibagi sebanding nilai (termasuk pajak) baris-barisnya. */
export const refundLineNets = (ds: Dataset): Map<RefundLineRec, number> => {
  const byRefund = new Map<string, RefundLineRec[]>();
  for (const r of ds.refundLines) byRefund.set(r.refundId, [...(byRefund.get(r.refundId) ?? []), r]);
  const out = new Map<RefundLineRec, number>();
  for (const f of ds.refunds) {
    const ls = byRefund.get(f.id) ?? [];
    const shares = allocateProportional(f.net, ls.map((l) => l.amount));
    ls.forEach((l, i) => out.set(l, shares[i]!));
  }
  return out;
};

export interface ItemRow {
  key: string;
  name: string;
  sold: number;
  refundedQty: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  refundAmount: number;
}

/**
 * Penjualan per kunci baris (item, kategori, merek, ...). Gross dan diskon adalah penjualan sebelum refund; net, HPP, dan `sold`
 * sudah dikurangi refund (jumlahnya cocok dengan ringkasan). Nilai refund (termasuk bagian pajak/service) ditampilkan terpisah.
 */
export const groupLines = (ds: Dataset, keyOf: (l: SaleLine) => { key: string; name: string } | null): ItemRow[] => {
  const nets = lineNets(ds);
  const refundNets = refundLineNets(ds);
  const out = new Map<string, ItemRow>();
  const at = (k: { key: string; name: string }) => {
    let r = out.get(k.key);
    if (!r) out.set(k.key, (r = { key: k.key, name: k.name, sold: 0, refundedQty: 0, grossSales: 0, discounts: 0, netSales: 0, cogs: 0, grossProfit: 0, refundAmount: 0 }));
    return r;
  };
  for (const l of ds.lines) {
    const k = keyOf(l);
    if (!k) continue;
    const r = at(k);
    r.sold += l.quantity;
    r.grossSales += l.unitPrice * l.quantity;
    r.discounts += l.lineDiscount + l.promoDiscount + l.orderDiscountShare;
    r.netSales += nets.get(l.id) ?? 0;
    r.cogs += l.cost * l.quantity;
  }
  for (const rl of ds.refundLines) {
    const k = keyOf(rl.line);
    if (!k) continue;
    const r = at(k);
    r.refundedQty += rl.quantity;
    r.refundAmount += rl.amount;
    r.netSales -= refundNets.get(rl) ?? 0;
    r.cogs -= rl.line.cost * rl.quantity;
  }
  for (const r of out.values()) {
    r.sold -= r.refundedQty;
    r.grossProfit = r.netSales - r.cogs;
  }
  return [...out.values()];
};

export interface GroupRow {
  key: string;
  orders: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  gratuity: number;
  tax: number;
  total: number;
}

export const groupOrders = (ds: Dataset, keyOf: (o: SaleOrder) => string): GroupRow[] => {
  const out = new Map<string, GroupRow>();
  for (const o of ds.orders) {
    const k = keyOf(o);
    let r = out.get(k);
    if (!r) out.set(k, (r = { key: k, orders: 0, grossSales: 0, discounts: 0, netSales: 0, gratuity: 0, tax: 0, total: 0 }));
    r.orders += 1;
    r.grossSales += o.subtotal;
    r.discounts += o.discountTotal;
    r.netSales += o.net;
    r.gratuity += o.gratuity;
    r.tax += o.tax;
    r.total += o.total;
  }
  return [...out.values()];
};

export interface PaymentRow {
  method: string;
  count: number;
  collected: number;
  refunded: number;
  net: number;
}

/** Per metode bayar: uang yang benar-benar diterima (setelah kembalian) dikurangi refund lewat metode itu. */
export const paymentMethods = (ds: Dataset): PaymentRow[] => {
  const out = new Map<string, PaymentRow>();
  const at = (m: string) => {
    let r = out.get(m);
    if (!r) out.set(m, (r = { method: m, count: 0, collected: 0, refunded: 0, net: 0 }));
    return r;
  };
  for (const p of ds.payments) {
    const r = at(p.method);
    r.count += 1;
    r.collected += p.applied;
  }
  for (const f of ds.refunds) at(f.method).refunded += f.total;
  for (const r of out.values()) r.net = r.collected - r.refunded;
  return [...out.values()];
};

export interface ChargeRow {
  key: string;
  name: string;
  amount: number;
}

/** Pajak atau service per nama, dari rincian yang dibekukan di setiap pesanan (sebelum refund). */
export const charges = (ds: Dataset, kind: "taxes" | "gratuities"): ChargeRow[] => {
  const out = new Map<string, ChargeRow>();
  for (const o of ds.orders) {
    for (const c of o.snapshot?.[kind] ?? []) {
      const key = c.id ?? c.name;
      const r = out.get(key) ?? { key, name: c.name, amount: 0 };
      r.amount += c.amount;
      out.set(key, r);
    }
  }
  return [...out.values()];
};

export interface DiscountRow {
  key: string;
  type: "discount" | "promo" | "manual";
  count: number;
  amount: number;
}

/** Diskon menurut sumbernya: diskon terdaftar (baris dan pesanan), promo otomatis. */
export const discountUsage = (ds: Dataset): DiscountRow[] => {
  const out = new Map<string, DiscountRow>();
  const add = (key: string, type: DiscountRow["type"], amount: number) => {
    if (amount <= 0) return;
    const r = out.get(`${type}:${key}`) ?? { key, type, count: 0, amount: 0 };
    r.count += 1;
    r.amount += amount;
    out.set(`${type}:${key}`, r);
  };
  const orderShareByOrder = new Map<string, number>();
  for (const l of ds.lines) {
    add(l.discount?.discountId ?? "", l.discount?.discountId ? "discount" : "manual", l.lineDiscount);
    if (l.promoId) add(l.promoId, "promo", l.promoDiscount);
    orderShareByOrder.set(l.orderId, (orderShareByOrder.get(l.orderId) ?? 0) + l.orderDiscountShare);
  }
  for (const o of ds.orders) add(o.orderDiscount?.discountId ?? "", o.orderDiscount?.discountId ? "discount" : "manual", orderShareByOrder.get(o.id) ?? 0);
  return [...out.values()];
};

export interface CashierRow {
  userId: string;
  orders: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  total: number;
  refunds: number;
}

export const collectedBy = (ds: Dataset): CashierRow[] => {
  const out = new Map<string, CashierRow>();
  const at = (u: string) => {
    let r = out.get(u);
    if (!r) out.set(u, (r = { userId: u, orders: 0, grossSales: 0, discounts: 0, netSales: 0, total: 0, refunds: 0 }));
    return r;
  };
  for (const o of ds.orders) {
    const r = at(o.userId);
    r.orders += 1;
    r.grossSales += o.subtotal;
    r.discounts += o.discountTotal;
    r.netSales += o.net;
    r.total += o.total;
  }
  for (const f of ds.refunds) at(f.userId).refunds += f.total;
  return [...out.values()];
};

export interface TableStats {
  orders: number;
  pax: number;
  revenue: number;
  revenuePerPax: number;
  averageMinutes: number;
}

/** Ringkasan meja: pesanan yang punya meja. Rata-rata waktu = bayar - buka bill; pendapatan per pax hanya dari pesanan berisi pax. */
export const tableStats = (ds: Dataset): TableStats => {
  const t = ds.orders.filter((o) => o.tableId);
  const withPax = t.filter((o) => (o.pax ?? 0) > 0);
  const pax = sum(withPax, (o) => o.pax ?? 0);
  const revenue = sum(t, (o) => o.total);
  const paxRevenue = sum(withPax, (o) => o.total);
  return {
    orders: t.length,
    pax,
    revenue,
    revenuePerPax: pax ? Math.round(paxRevenue / pax) : 0,
    averageMinutes: t.length ? Math.round(sum(t, (o) => (o.paidAt.getTime() - o.openedAt.getTime()) / 60_000) / t.length) : 0,
  };
};
