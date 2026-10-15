import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orders, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let INV: string;
let cashier: { device: string; token: string };
let admin: { device: string; token: string };
let adminId = "";
let takeAway = "";
let kopi = "";
let general10 = "";
let tableId = "";
let o1 = "";
let o2 = "";
let o3 = "";
let cashierShiftId = "";
const ADMIN_PIN = "739206";
const approval = () => ({ userId: adminId, pin: ADMIN_PIN });

const idOf = async (email: string) => (await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]!.id;
const pairAndLogin = async (bo: string, outletId: string, email: string, pin: string) => {
  const uid = await idOf(email);
  await call(fx.app, "POST", `/employees/${uid}/pin`, { token: bo, body: { pin } });
  const created = await call(fx.app, "POST", "/devices", { token: bo, body: { outletId, name: `T-${pin}` } });
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
  const device = act.json.deviceToken as string;
  const res = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: uid, pin } });
  return { device, token: res.json.accessToken as string };
};
const pos = (who: { device: string; token: string }, method: string, path: string, body?: unknown) =>
  call(fx.app, method, `/pos${path}`, { token: who.token, headers: { "x-device-token": who.device }, body });
const kopiLine = (qty: number) => ({ kind: "item", variantId: kopi, quantity: qty, modifierOptionIds: [] });
const cart = (lines: unknown[], extra: Record<string, unknown> = {}) => ({ salesTypeId: takeAway, lines, ...extra });
const rep = (token: string, path: string, query = "") => call(fx.app, "GET", `/reports/${path}${query ? `?${query}` : ""}`, { token });
const row = (res: { json: any }, name: string) => res.json.rows.find((r: any) => r.name === name || r.method === name || r.metric === name);

const O1 = () => fx.a.outletIds[0]!;

beforeAll(async () => {
  fx = await setupFixture();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  INV = (await login(fx.app, fx.a.investorEmail)).token!;
  const types = (await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[];
  takeAway = types.find((t) => /take/i.test(t.name))!.id;
  await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } });
  const k = await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi", variants: [{ name: "R", basePrice: 22000, cost: 8000, sku: "KOPI" }] } });
  kopi = k.json.variants[0].id;
  general10 = (await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Umum 10%", kind: "percent", value: 1000, allOutlets: true } })).json.id;
  tableId = (await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), name: "M1" } })).json.id;

  cashier = await pairAndLogin(A, O1(), fx.a.cashierEmail, "482615");
  admin = await pairAndLogin(A, O1(), fx.a.adminEmail, ADMIN_PIN);
  adminId = await idOf(fx.a.adminEmail);
  const open = await pos(cashier, "POST", "/shifts/open", { openingCash: 100000 });
  cashierShiftId = open.json.shift.id;
  await pos(admin, "POST", "/shifts/open", { openingCash: 0 });

  // O1: 3 kopi di meja M1 (4 orang), tunai
  const b1 = await pos(cashier, "POST", "/orders", cart([kopiLine(3)], { tableId, pax: 4 }));
  o1 = b1.json.order.id;
  await pos(cashier, "POST", `/orders/${o1}/pay`, { payments: [{ method: "cash", amount: 80000 }] });
  // O2: 1 kopi, kartu
  const b2 = await pos(cashier, "POST", "/orders", cart([kopiLine(1)]));
  o2 = b2.json.order.id;
  await pos(cashier, "POST", `/orders/${o2}/pay`, { payments: [{ method: "card", amount: 24420 }] });
  // O3: 2 kopi dengan diskon pesanan umum 10% (admin), tunai
  const b3 = await pos(admin, "POST", "/orders", cart([kopiLine(2)], { orderDiscount: { discountId: general10 } }));
  o3 = b3.json.order.id;
  expect(b3.json.order.totals.total).toBe(43956);
  await pos(admin, "POST", `/orders/${o3}/pay`, { payments: [{ method: "cash", amount: 50000 }] });
  // Refund 1 dari 3 kopi di O1 (tunai)
  const detail = await pos(cashier, "GET", `/orders/${o1}`);
  const refund = await pos(cashier, "POST", `/orders/${o1}/refund`, { lines: [{ lineId: detail.json.order.lines[0].id, quantity: 1 }], method: "cash", reason: "salah menu", approval: approval() });
  expect(refund.json.refund.total).toBe(24420);
  // Bill dibatalkan dan item dihapus dari bill tersimpan
  const b5 = await pos(cashier, "POST", "/orders", cart([kopiLine(2)]));
  await pos(cashier, "PUT", `/orders/${b5.json.order.id}`, { ...cart([kopiLine(1)]), reason: "kurangi", approval: approval() });
  await pos(cashier, "POST", `/orders/${b5.json.order.id}/void`, { reason: "tamu pergi", approval: approval() });
});
afterAll(async () => {
  await fx.handle.close();
});

describe("ringkasan penjualan: angka cocok dengan hitungan tangan", () => {
  it("metrik dan identitas: net + service + pajak + pembulatan = total diterima", async () => {
    const res = await rep(A, "summary");
    expect(res.status).toBe(200);
    const m = res.json.metrics;
    // O1 73.260 (66.000 + pajak 7.260), O2 24.420, O3 43.956 (44.000 - 4.400 + pajak 4.356); refund 24.420 (net 22.000, pajak 2.420)
    expect(m).toMatchObject({
      orders: 3,
      itemsSold: 5,
      grossSales: 132_000,
      discounts: 4_400,
      includedCharges: 0,
      refunds: 22_000,
      netSales: 105_600,
      cogs: 40_000,
      grossProfit: 65_600,
      gratuity: 0,
      tax: 11_616,
      rounding: 0,
      totalCollected: 117_216,
      refundsTotal: 24_420,
      averageOrder: 47_212,
    });
    expect(m.netSales + m.gratuity + m.tax + m.rounding).toBe(m.totalCollected);
  });

  it("tabel berdiri sendiri menjumlah ke angka ringkasan", async () => {
    const items = await rep(A, "items");
    const kopiRow = row(items, "Kopi");
    expect(kopiRow).toMatchObject({ sold: 5, refundedQty: 1, grossSales: 132_000, discounts: 4_400, netSales: 105_600, cogs: 40_000, grossProfit: 65_600, refundAmount: 24_420 });
    expect(items.json.totals.netSales).toBe(105_600);

    const cats = await rep(A, "categories");
    expect(cats.json.rows).toHaveLength(1);
    expect(cats.json.rows[0]).toMatchObject({ key: "none", name: "", share: 10_000, netSales: 105_600 });

    const pay = await rep(A, "payments");
    expect(row(pay, "cash")).toMatchObject({ count: 2, collected: 117_216, refunded: 24_420, net: 92_796 });
    expect(row(pay, "card")).toMatchObject({ count: 1, collected: 24_420, refunded: 0, net: 24_420 });
    expect(pay.json.totals.net).toBe(117_216);

    const st = await rep(A, "sales-types");
    expect(st.json.rows).toHaveLength(1);
    expect(st.json.rows[0]).toMatchObject({ orders: 3, grossSales: 132_000, total: 141_636 });

    const tax = await rep(A, "taxes");
    expect(tax.json.rows).toEqual([{ name: "PPN", amount: 14_036 }]);
    expect((await rep(A, "gratuity")).json.rows).toEqual([]);

    const disc = await rep(A, "discounts");
    expect(disc.json.rows).toEqual([{ name: "Umum 10%", type: "discount", count: 1, amount: 4_400 }]);

    const by = await rep(A, "collected-by");
    expect(by.json.rows.find((r: any) => r.name.startsWith("Kasir"))).toMatchObject({ orders: 2, refunds: 24_420, total: 97_680 });
    expect(by.json.rows.find((r: any) => r.name.startsWith("Admin"))).toMatchObject({ orders: 1, total: 43_956 });

    expect(row(await rep(A, "brands"), "")).toMatchObject({ key: "none", sold: 5 });
  });

  it("meja: durasi, pax, pendapatan per pax", async () => {
    const res = await rep(A, "tables");
    expect(res.json.rows).toHaveLength(1);
    expect(res.json.rows[0]).toMatchObject({ table: "M1", pax: 4, total: 73_260 });
    expect(res.json.stats).toMatchObject({ orders: 1, pax: 4, revenue: 73_260, revenuePerPax: 18_315 });
  });

  it("dasbor: seri harian, per jam, per hari-minggu, perbandingan outlet, item teratas", async () => {
    const d = (await rep(A, "dashboard")).json;
    expect(d.metrics.netSales).toBe(105_600);
    expect(d.daily).toHaveLength(7); // bawaan: 7 hari berakhir hari ini
    expect(d.daily.reduce((a: number, b: any) => a + b.orders, 0)).toBe(3);
    expect(d.daily.reduce((a: number, b: any) => a + b.netSales, 0)).toBe(105_600);
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly.reduce((a: number, b: any) => a + b.orders, 0)).toBe(3);
    expect(d.weekday).toHaveLength(7);
    expect(d.weekday.reduce((a: number, b: any) => a + b.orders, 0)).toBe(3);
    expect(d.topItems[0]).toMatchObject({ name: "Kopi", sold: 5 });
    const pusat = d.outletComparison.find((o: any) => o.outletId === O1());
    expect(pusat).toMatchObject({ orders: 3, netSales: 105_600 });
    expect(d.outletComparison.find((o: any) => o.outletId === fx.a.outletIds[1])).toMatchObject({ orders: 0, netSales: 0 });
    expect(d.tables.pax).toBe(4);
    const cmp = await rep(A, "outlets");
    expect(cmp.json.totals.netSales).toBe(105_600);
  });
});

describe("transaksi, shift, dan ekspor", () => {
  it("daftar transaksi per tab, pencarian nomor struk, dan rincian", async () => {
    const ok = await rep(A, "transactions", "tab=success");
    expect(ok.json.total).toBe(3);
    expect(ok.json.rows[0].receipt).toBeGreaterThan(ok.json.rows[2].receipt);
    const receipt = ok.json.rows.find((r: any) => r.id === o1).receipt;
    const found = await rep(A, "transactions", `tab=success&q=${receipt}`);
    expect(found.json.rows.map((r: any) => r.id)).toEqual([o1]);

    const cancelled = await rep(A, "transactions", "tab=cancelled");
    expect(cancelled.json.total).toBe(1);
    expect(cancelled.json.rows[0].reason).toBe("tamu pergi");

    const voided = await rep(A, "transactions", "tab=void_items");
    expect(voided.json.total).toBe(1);
    expect(voided.json.rows[0]).toMatchObject({ items: "1× Kopi", reason: "kurangi", approvedBy: expect.stringContaining("Admin") });

    const detail = await call(fx.app, "GET", `/reports/transactions/${o1}`, { token: A });
    expect(detail.json.order).toMatchObject({ receiptNumber: receipt, table: "M1", pax: 4, totals: { total: 73_260, refunded: 24_420 } });
    expect(detail.json.order.refunds[0]).toMatchObject({ total: 24_420, reason: "salah menu" });
    expect(detail.json.order.activities.map((a: any) => a.kind)).toContain("refund");
    expect((await call(fx.app, "GET", `/reports/transactions/${o1}`, { token: B })).status).toBe(404);
  });

  it("laporan shift: shift terbuka dihitung langsung dan cocok dengan ringkasan kasir", async () => {
    const res = await rep(A, "shifts");
    const mine = res.json.rows.find((r: any) => r.id === cashierShiftId);
    // modal 100.000 + tunai O1 73.260 - refund tunai 24.420 (O3 tunai ada di shift admin)
    expect(mine).toMatchObject({ openingCash: 100_000, cashSales: 73_260, cashRefunds: 24_420, nonCashSales: 24_420, expectedCash: 148_840, closedAt: null });
    const live = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    expect(live.expectedCash).toBe(mine.expectedCash);
    const closed = await pos(cashier, "POST", "/shifts/close", { actualCash: 148_000 });
    expect(closed.json.shift.difference).toBe(-840);
    const after = (await rep(A, "shifts")).json.rows.find((r: any) => r.id === cashierShiftId);
    expect(after).toMatchObject({ expectedCash: 148_840, actualCash: 148_000, difference: -840 });
  });

  it("ekspor CSV: BOM, judul kolom dalam bahasa permintaan, baris total, uang tanpa pemisah ribuan", async () => {
    const res = await fx.app.request("/api/v1/reports/items?format=csv", { headers: { authorization: `Bearer ${A}`, "x-locale": "en" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/naqdi-items-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes); // TextDecoder sudah membuang BOM (BOM diperiksa di atas)
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("Name,Sold,Refunded qty,Gross sales,Discounts,Net sales,COGS,Gross profit,Refund amount");
    expect(lines[1]).toBe("Kopi,5,1,132000,4400,105600,40000,65600,24420");
    expect(lines[2]).toBe("Total,5,1,132000,4400,105600,40000,65600,24420");
    const id = await fx.app.request("/api/v1/reports/payments?format=csv", { headers: { authorization: `Bearer ${A}`, "x-locale": "id" } });
    expect(new TextDecoder().decode(await id.arrayBuffer()).split("\r\n")[0]).toContain("Metode,Jumlah,Diterima");
  });
});

describe("rentang tanggal, zona waktu, dan akses", () => {
  it("rentang tanggal ditegakkan; tanggal tak valid atau terbalik atau >366 hari ditolak", async () => {
    expect((await rep(A, "summary", "from=2030-01-01&to=2030-01-31")).json.metrics.orders).toBe(0);
    expect((await rep(A, "summary", "from=2026-02-30&to=2026-03-01")).status).toBe(422);
    expect((await rep(A, "summary", "from=2026-03-02&to=2026-03-01")).status).toBe(422);
    expect((await rep(A, "summary", "from=2025-01-01&to=2026-12-31")).status).toBe(422);
    expect((await rep(A, "summary", "from=bukan&to=tanggal")).status).toBe(422);
  });

  it("batas hari mengikuti zona waktu outlet (Asia/Jakarta, UTC+7) tepat sampai detik", async () => {
    const day = "2026-03-14";
    const next = "2026-03-15";
    const set = (at: string) => fx.handle.db.update(orders).set({ paidAt: new Date(at) }).where(eq(orders.id, o2));
    const count = async (d: string) => (await rep(A, "summary", `from=${d}&to=${d}&outletIds=${O1()}`)).json.metrics.orders as number;
    await set("2026-03-14T16:59:59.000Z"); // 23:59:59 tanggal 14 di Jakarta
    expect(await count(day)).toBe(1);
    expect(await count(next)).toBe(0);
    await set("2026-03-14T17:00:00.000Z"); // 00:00:00 tanggal 15
    expect(await count(day)).toBe(0);
    expect(await count(next)).toBe(1);
    const dash = (await rep(A, "dashboard", `from=${day}&to=${next}`)).json;
    expect(dash.daily.map((d: any) => [d.key, d.orders])).toEqual([[day, 0], [next, 1]]);
    expect(dash.hourly[0].orders).toBe(1); // jam 00 setempat
  });

  it("outlet di luar penugasan ditolak; tanpa pilihan hanya outlet sendiri; bisnis lain tidak terlihat", async () => {
    const roleId = fx.a.roleIds.regionalManager!;
    const created = await call(fx.app, "POST", "/employees", {
      token: A,
      body: { name: "Manajer Satu", email: `m1${fx.a.emailSuffix}`, password: "Rahasia123!", roleId, outletIds: [O1()], status: "active" },
    });
    expect(created.status).toBe(201);
    const M = (await login(fx.app, `m1${fx.a.emailSuffix}`)).token!;
    expect((await rep(M, "summary", `outletIds=${fx.a.outletIds[1]}`)).status).toBe(403);
    const mine = await rep(M, "dashboard");
    expect(mine.json.outlets.map((o: any) => o.id)).toEqual([O1()]);
    expect(mine.json.outletComparison).toHaveLength(1);

    expect((await rep(B, "summary")).json.metrics.orders).toBe(0);
    expect((await rep(B, "summary", `outletIds=${O1()}`)).status).toBe(403);
    expect((await rep(INV, "summary")).status).toBe(200); // investor: reports.view
    const noReports = await login(fx.app, fx.a.cashierEmail);
    expect(noReports.token).toBeUndefined(); // kasir app-only tidak bisa masuk Back Office
  });
});
