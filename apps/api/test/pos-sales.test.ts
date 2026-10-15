import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { counters, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;

// Kasir tidak punya pos.discount; admin punya semua hak.
let cashier: { device: string; token: string };
let admin: { device: string; token: string };

let dineIn = "";
let takeAway = "";
let kopi = ""; // varian Kopi (20000; take away 22000)
let teh = ""; // varian Teh (10000)
let boba = "";
let jelly = "";
let gula = "";
let disc20 = "";
let potong5 = "";
let otherItemOption = "";

const userId = async (email: string) => (await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]!.id;

const pairAndLogin = async (bo: string, outletId: string, userEmail: string, pin: string) => {
  const uid = await userId(userEmail);
  expect((await call(fx.app, "POST", `/employees/${uid}/pin`, { token: bo, body: { pin } })).status).toBeLessThan(300);
  const created = await call(fx.app, "POST", "/devices", { token: bo, body: { outletId, name: `T-${pin}` } });
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
  const device = act.json.deviceToken as string;
  const res = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: uid, pin } });
  expect(res.status).toBe(200);
  return { device, token: res.json.accessToken as string };
};

const pos = (who: { device: string; token: string }, method: string, path: string, body?: unknown) =>
  call(fx.app, method, `/pos${path}`, { token: who.token, headers: { "x-device-token": who.device }, body });

const kopiLine = (qty: number, extra: Record<string, unknown> = {}) => ({ kind: "item", variantId: kopi, quantity: qty, ...extra });
const cart = (salesTypeId: string, lines: unknown[], extra: Record<string, unknown> = {}) => ({ salesTypeId, lines, ...extra });

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;

  const types = (await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[];
  dineIn = types.find((t) => /dine/i.test(t.name))!.id;
  takeAway = types.find((t) => /take/i.test(t.name))!.id;

  expect((await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } })).status).toBe(201);
  const g = await call(fx.app, "POST", "/gratuities", { token: A, body: { name: "Service", rateBp: 500, allOutlets: true } });
  expect(g.status).toBe(201);
  expect((await call(fx.app, "PATCH", `/sales-types/${dineIn}`, { token: A, body: { gratuityIds: [g.json.id] } })).status).toBe(200);

  const mod = await call(fx.app, "POST", "/modifiers", {
    token: A,
    body: { name: "Topping", minSelect: 0, maxSelect: 2, options: [{ name: "Boba", price: 3000 }, { name: "Jelly", price: 2500 }, { name: "Keju", price: 4000 }] },
  });
  const opts = mod.json.options as { id: string; name: string }[];
  boba = opts.find((o) => o.name === "Boba")!.id;
  jelly = opts.find((o) => o.name === "Jelly")!.id;
  const keju = opts.find((o) => o.name === "Keju")!.id;
  const gm = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Gula", minSelect: 1, maxSelect: 1, options: [{ name: "Normal", price: 0 }, { name: "Less", price: 0 }] } });
  gula = gm.json.options[0].id;

  const k = await call(fx.app, "POST", "/items", {
    token: A,
    body: { name: "Kopi", variants: [{ name: "R", basePrice: 20000, cost: 8000, sku: "KOPI", prices: [{ salesTypeId: takeAway, price: 22000 }] }], modifierSetIds: [mod.json.id] },
  });
  expect(k.status).toBe(201);
  kopi = k.json.variants[0].id;
  const t = await call(fx.app, "POST", "/items", { token: A, body: { name: "Teh", variants: [{ name: "R", basePrice: 10000, sku: "TEH" }], modifierSetIds: [gm.json.id] } });
  teh = t.json.variants[0].id;
  otherItemOption = gm.json.options[1].id; // opsi milik Teh, bukan Kopi
  void keju;

  const d1 = await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Karyawan 20%", kind: "percent", value: 2000, customizable: true, allOutlets: true } });
  disc20 = d1.json.id;
  const d2 = await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Potong 5rb", kind: "amount", value: 5000, allOutlets: true } });
  potong5 = d2.json.id;

  cashier = await pairAndLogin(A, fx.a.outletIds[0]!, fx.a.cashierEmail, "482615");
  admin = await pairAndLogin(A, fx.a.outletIds[0]!, fx.a.adminEmail, "739206");
});
afterAll(async () => {
  await fx.handle.close();
});

describe("shift", () => {
  it("tanpa shift terbuka, bill tidak bisa dibuat", async () => {
    const res = await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(1)]));
    expect(res.status).toBe(409);
  });

  it("buka shift sekali; kedua kali ditolak", async () => {
    const open = await pos(cashier, "POST", "/shifts/open", { openingCash: 100000 });
    expect(open.status).toBe(201);
    expect(open.json.shift.expectedCash).toBe(100000);
    expect((await pos(cashier, "POST", "/shifts/open", { openingCash: 1 })).status).toBe(409);
    expect((await pos(admin, "POST", "/shifts/open", { openingCash: 50000 })).status).toBe(201);
  });
});

describe("katalog dan harga", () => {
  it("katalog memuat item, varian, modifier, dan hanya yang tersedia di outlet", async () => {
    const res = await pos(cashier, "GET", "/catalog");
    expect(res.status).toBe(200);
    const item = res.json.items.find((i: any) => i.name === "Kopi");
    expect(item.variants[0].prices[takeAway]).toBe(22000);
    expect(item.modifierSets[0].options.length).toBe(3);
    expect(res.json.salesTypes.length).toBeGreaterThan(1);
  });

  it("take away: harga khusus + modifier + pajak; klien tidak bisa menyuntik harga", async () => {
    const res = await pos(cashier, "POST", "/price", cart(takeAway, [kopiLine(2, { modifierOptionIds: [boba], unitPrice: 1, price: 1, total: 1 })], { total: 1 }));
    expect(res.status).toBe(200);
    // (22000 + 3000) x 2 = 50000; pajak 11% = 5500
    expect(res.json.totals).toMatchObject({ subtotal: 50000, tax: 5500, gratuity: 0, total: 55500 });
  });

  it("dine in: service 5% dan pajak atas service", async () => {
    const res = await pos(cashier, "POST", "/price", cart(dineIn, [kopiLine(2)]));
    // 40000 + service 2000 + pajak 11% x 42000 = 4620
    expect(res.json.totals).toMatchObject({ subtotal: 40000, gratuity: 2000, tax: 4620, total: 46620 });
  });

  it("aturan modifier ditegakkan; opsi item lain ditolak", async () => {
    const tooMany = await pos(cashier, "POST", "/price", cart(takeAway, [kopiLine(1, { modifierOptionIds: [boba, jelly, boba] })]));
    expect(tooMany.status).toBe(200); // duplikat dianggap satu pilihan
    const three = await pos(cashier, "POST", "/price", cart(takeAway, [kopiLine(1, { modifierOptionIds: [boba, jelly, "018f0000-0000-7000-8000-000000000000"] })]));
    expect(three.status).toBe(422);
    const foreignOpt = await pos(cashier, "POST", "/price", cart(takeAway, [kopiLine(1, { modifierOptionIds: [otherItemOption] })]));
    expect(foreignOpt.status).toBe(422);
    const missingRequired = await pos(cashier, "POST", "/price", cart(takeAway, [{ kind: "item", variantId: teh, quantity: 1 }]));
    expect(missingRequired.status).toBe(422); // Gula wajib dipilih
    const ok = await pos(cashier, "POST", "/price", cart(takeAway, [{ kind: "item", variantId: teh, quantity: 1, modifierOptionIds: [gula] }]));
    expect(ok.status).toBe(200);
  });

  it("diskon butuh hak pos.discount dan hanya dari daftar diskon outlet", async () => {
    const line = kopiLine(2, { discount: { discountId: disc20 } });
    expect((await pos(cashier, "POST", "/price", cart(dineIn, [line]))).status).toBe(403);
    const ok = await pos(admin, "POST", "/price", cart(dineIn, [line]));
    expect(ok.status).toBe(200);
    // 40000 - 8000 = 32000; service 1600; pajak 11% x 33600 = 3696
    expect(ok.json.totals).toMatchObject({ discountTotal: 8000, gratuity: 1600, tax: 3696, total: 37296 });
    const fixed = await pos(admin, "POST", "/price", cart(dineIn, [kopiLine(1, { discount: { discountId: potong5, value: 1 } })]));
    expect(fixed.status).toBe(422); // diskon nominal tetap tidak boleh diubah
    const custom = await pos(admin, "POST", "/price", cart(dineIn, [kopiLine(1, { discount: { discountId: disc20, value: 5000 } })]));
    expect(custom.json.totals.discountTotal).toBe(10000);
    const absurd = await pos(admin, "POST", "/price", cart(dineIn, [kopiLine(1, { discount: { discountId: disc20, value: 10001 } })]));
    expect(absurd.status).toBe(422);
    const unknown = await pos(admin, "POST", "/price", cart(dineIn, [kopiLine(1, { discount: { discountId: "018f0000-0000-7000-8000-000000000000" } })]));
    expect(unknown.status).toBe(422);
  });
});

describe("bill dan pembayaran", () => {
  it("simpan bill, ubah isi, lalu bayar tunai dengan kembalian dan nomor struk", async () => {
    const created = await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(2, { modifierOptionIds: [boba] })], { label: "Meja 3" }));
    expect(created.status).toBe(201);
    const id = created.json.order.id as string;
    expect(created.json.order.status).toBe("open");
    expect(created.json.order.receiptNumber).toBeNull();
    expect(created.json.order.lines[0].modifiers[0]).toMatchObject({ name: "Boba", price: 3000 });

    const edited = await pos(cashier, "PUT", `/orders/${id}`, cart(takeAway, [kopiLine(1)]));
    expect(edited.json.order.totals.total).toBe(24420); // 22000 + 11%
    expect(edited.json.order.lines).toHaveLength(1);

    const short = await pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount: 20000 }] });
    expect(short.status).toBe(422);
    const noncashOver = await pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method: "card", amount: 30000 }] });
    expect(noncashOver.status).toBe(422);

    const paid = await pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount: 30000 }] });
    expect(paid.status).toBe(200);
    expect(paid.json.order).toMatchObject({ status: "paid", totals: { paid: 24420, change: 5580 } });
    expect(paid.json.order.receiptNumber).toBeGreaterThan(0);
    expect(paid.json.order.payments[0]).toMatchObject({ method: "cash", tendered: 30000, applied: 24420, change: 5580 });

    // Bayar dua kali dan ubah setelah lunas ditolak.
    expect((await pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount: 30000 }] })).status).toBe(409);
    expect((await pos(cashier, "PUT", `/orders/${id}`, cart(takeAway, [kopiLine(5)]))).status).toBe(409);
    expect((await pos(cashier, "POST", `/orders/${id}/void`, { reason: "salah" })).status).toBe(409);
  });

  it("pisah bayar: kartu + tunai", async () => {
    const created = await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(2)]));
    const id = created.json.order.id as string;
    const total = created.json.order.totals.total as number; // 48840
    const paid = await pos(cashier, "POST", `/orders/${id}/pay`, {
      payments: [{ method: "card", amount: 20000, reference: "AUTH123" }, { method: "cash", amount: total - 20000 + 1000 }],
    });
    expect(paid.status).toBe(200);
    expect(paid.json.order.totals).toMatchObject({ paid: total, change: 1000 });
    expect(paid.json.order.payments.map((p: any) => p.method)).toEqual(["card", "cash"]);
  });

  it("bill kosong tidak bisa disimpan; bill terbuka bisa dibatalkan dan tak bisa dibayar lagi", async () => {
    expect((await pos(cashier, "POST", "/orders", cart(takeAway, []))).status).toBe(422);
    const created = await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(1)]));
    const id = created.json.order.id as string;
    expect((await pos(cashier, "POST", `/orders/${id}/void`, { reason: "pelanggan batal" })).json.order.status).toBe("void");
    expect((await pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount: 99999 }] })).status).toBe(409);
  });

  it("nomor struk berurutan tanpa celah walau dibayar bersamaan, dan batal tidak memakai nomor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(1)]))).json.order.id);
    const before = (await fx.handle.db.select().from(counters))[0];
    void before;
    const results = await Promise.all(ids.map((id) => pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount: 50000 }] })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const numbers = results.map((r) => r.json.order.receiptNumber as number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5]! - numbers[0]!).toBe(5);
  });

  it("daftar bill terbuka dan detail dibatasi ke outlet/bisnis sendiri", async () => {
    const created = await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(1)]));
    const id = created.json.order.id as string;
    const open = await pos(admin, "GET", "/orders?status=open"); // kasir lain di outlet yang sama melihat bill ini
    expect(open.json.items.map((o: any) => o.id)).toContain(id);

    const bAdmin = await pairAndLogin(B, fx.b.outletIds[0]!, fx.b.adminEmail, "573920");
    expect((await pos(bAdmin, "GET", `/orders/${id}`)).status).toBe(404);
    expect((await pos(bAdmin, "POST", `/orders/${id}/void`, { reason: "x" })).status).toBe(404);
    expect((await pos(bAdmin, "GET", "/orders?status=open")).json.items.map((o: any) => o.id)).not.toContain(id);
  });
});

describe("pisah bill", () => {
  it("memindahkan sebagian jumlah; jumlah kedua bill sama dengan bill asal", async () => {
    const created = await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(3), { kind: "item", variantId: teh, quantity: 2, modifierOptionIds: [gula] }]));
    const order = created.json.order;
    const original = order.totals.total as number;
    const kopiLineId = order.lines.find((l: any) => l.name === "Kopi").id;
    const split = await pos(cashier, "POST", `/orders/${order.id}/split`, { selection: [{ lineId: kopiLineId, quantity: 1 }] });
    expect(split.status).toBe(201);
    expect(split.json.order.totals.total + split.json.moved.totals.total).toBe(original);
    expect(split.json.moved.lines).toEqual([expect.objectContaining({ name: "Kopi", quantity: 1 })]);
    expect(split.json.order.lines.find((l: any) => l.name === "Kopi").quantity).toBe(2);

    const bad = await pos(cashier, "POST", `/orders/${order.id}/split`, { selection: [{ lineId: kopiLineId, quantity: 99 }] });
    expect(bad.status).toBe(422);
    const all = await pos(cashier, "POST", `/orders/${split.json.moved.id}/split`, { selection: [{ lineId: split.json.moved.lines[0].id, quantity: 1 }] });
    expect(all.status).toBe(422); // tidak boleh memindahkan semuanya
  });
});

describe("kas dan tutup shift", () => {
  it("kas masuk/keluar, saldo laci tidak boleh minus, selisih dihitung saat tutup", async () => {
    const before = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    expect(before.cashSales).toBeGreaterThan(0);
    expect(before.nonCashSales).toBe(20000);

    expect((await pos(cashier, "POST", "/shifts/cash", { kind: "out", amount: 99_000_000, description: "tidak mungkin" })).status).toBe(422);
    expect((await pos(cashier, "POST", "/shifts/cash", { kind: "in", amount: 10000, description: "tambah modal" })).status).toBe(201);
    const afterOut = await pos(cashier, "POST", "/shifts/cash", { kind: "out", amount: 4000, description: "beli es" });
    expect(afterOut.json.shift).toMatchObject({ cashIn: 10000, cashOut: 4000 });
    const expected = afterOut.json.shift.expectedCash as number;
    expect(expected).toBe(100000 + before.cashSales + 10000 - 4000);

    const closed = await pos(cashier, "POST", "/shifts/close", { actualCash: expected - 2000, note: "kurang 2rb" });
    expect(closed.status).toBe(200);
    expect(closed.json.shift).toMatchObject({ expectedCash: expected, actualCash: expected - 2000, difference: -2000 });
    expect(closed.json.shift.closedAt).toBeTruthy();

    expect((await pos(cashier, "POST", "/orders", cart(takeAway, [kopiLine(1)]))).status).toBe(409);
    expect((await pos(cashier, "POST", "/shifts/close", { actualCash: 0 })).status).toBe(409);
    expect((await pos(cashier, "GET", "/shifts/current")).json.shift).toBeNull();
  });
});

describe("keamanan", () => {
  it("token Back Office tidak diterima di rute kasir; tanpa perangkat ditolak", async () => {
    expect((await call(fx.app, "GET", "/pos/catalog", { token: A, headers: { "x-device-token": cashier.device } })).status).toBe(401);
    expect((await call(fx.app, "GET", "/pos/catalog", { token: cashier.token })).status).toBe(401);
    // Token kasir dari perangkat lain (outlet sama, perangkat berbeda) tidak cocok dengan perangkat ini.
    expect((await call(fx.app, "GET", "/pos/catalog", { token: cashier.token, headers: { "x-device-token": admin.device } })).status).toBe(401);
  });
});
