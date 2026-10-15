import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stockLevels, stockMovements, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let INV: string;
let cashier: { device: string; token: string };
let adminId = "";
let takeAway = "";
const ADMIN_PIN = "739206";
const approval = () => ({ userId: adminId, pin: ADMIN_PIN });

let biji = "";
let susu = "";
let gula = "";
let sirup = "";
let kopiVariant = "";
let kopiItem = "";
let airVariant = "";
let extraShot = "";
let supplier = "";

const O1 = () => fx.a.outletIds[0]!;
const O2 = () => fx.a.outletIds[1]!;

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
const pos = (method: string, path: string, body?: unknown) => call(fx.app, method, `/pos${path}`, { token: cashier.token, headers: { "x-device-token": cashier.device }, body });
const inv = (method: string, path: string, body?: unknown, token = A) => call(fx.app, method, `/inventory${path}`, { token, body });

/** Saldo satu objek di satu outlet (jumlah, biaya rata-rata) dari daftar stok API. */
const level = async (outletId: string, subjectId: string) => {
  const res = await inv("GET", `/stock?outletId=${outletId}&pageSize=100`);
  return res.json.items.find((r: any) => r.subjectId === subjectId) as { quantity: number; avgCost: number; value: number; status: string; alertLow: number };
};
const sellLine = (variantId: string, quantity: number, modifierOptionIds: string[] = []) => ({ kind: "item", variantId, quantity, modifierOptionIds });
const bill = async (lines: unknown[]) => (await pos("POST", "/orders", { salesTypeId: takeAway, lines })).json.order;
const pay = (id: string, amount: number, extra: Record<string, unknown> = {}) => pos("POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount }], ...extra });
const setMode = (mode: string) => call(fx.app, "PATCH", `/outlets/${O1()}`, { token: A, body: { stockMode: mode } });

beforeAll(async () => {
  fx = await setupFixture();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  INV = (await login(fx.app, fx.a.investorEmail)).token!;
  takeAway = ((await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[]).find((t) => /take/i.test(t.name))!.id;
  await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } });

  const mk = async (body: Record<string, unknown>) => (await call(fx.app, "POST", "/ingredients", { token: A, body })).json;
  biji = (await mk({ name: "Biji kopi", unit: "g" })).id;
  susu = (await mk({ name: "Susu", unit: "ml" })).id;
  gula = (await mk({ name: "Gula", unit: "g" })).id;
  sirup = (await mk({ name: "Sirup gula", kind: "semi", unit: "ml", yieldQty: 1000, recipe: [{ componentId: gula, quantity: 600 }] })).id;

  const mod = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Tambahan", options: [{ name: "Extra shot", price: 5000 }] } });
  extraShot = mod.json.options[0].id;
  const kopi = await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi Susu", modifierSetIds: [mod.json.id], variants: [{ name: "R", basePrice: 30000, cost: 5000, sku: "KS" }] } });
  kopiItem = kopi.json.id;
  kopiVariant = kopi.json.variants[0].id;
  const air = await call(fx.app, "POST", "/items", { token: A, body: { name: "Air Mineral", trackStock: true, variants: [{ name: "R", basePrice: 5000, cost: 2000, sku: "AIR" }] } });
  airVariant = air.json.variants[0].id;
  supplier = (await call(fx.app, "POST", "/suppliers", { token: A, body: { name: "CV Maju", phone: "0811", city: "Jakarta" } })).json.id;

  cashier = await pairAndLogin(A, O1(), fx.a.cashierEmail, "482615");
  adminId = await idOf(fx.a.adminEmail);
  await call(fx.app, "POST", `/employees/${adminId}/pin`, { token: A, body: { pin: ADMIN_PIN } });
  await pos("POST", "/shifts/open", { openingCash: 0 });
});
afterAll(async () => {
  await fx.handle.close();
});

describe("bahan, resep, dan pemasok", () => {
  it("resep varian dan stok modifier tersimpan; bahan mentah tidak boleh punya resep; siklus ditolak", async () => {
    const put = await call(fx.app, "PUT", `/ingredients/recipes/variants/${kopiVariant}`, { token: A, body: { lines: [{ ingredientId: biji, quantity: 18 }, { ingredientId: susu, quantity: 200 }] } });
    expect(put.status).toBe(200);
    expect(put.json.lines).toEqual([expect.objectContaining({ name: "Biji kopi", quantity: 18 }), expect.objectContaining({ name: "Susu", quantity: 200 })]);
    expect((await call(fx.app, "PUT", `/ingredients/recipes/options/${extraShot}`, { token: A, body: { lines: [{ ingredientId: biji, quantity: 9 }] } })).status).toBe(200);
    expect((await call(fx.app, "POST", "/ingredients", { token: A, body: { name: "Mentah berresep", unit: "g", recipe: [{ componentId: biji, quantity: 1 }] } })).status).toBe(422);
    // 0,0001 bukan kelipatan 0,001
    expect((await call(fx.app, "PUT", `/ingredients/recipes/variants/${kopiVariant}`, { token: A, body: { lines: [{ ingredientId: biji, quantity: 0.0001 }] } })).status).toBe(422);

    const s2 = (await call(fx.app, "POST", "/ingredients", { token: A, body: { name: "Sirup B", kind: "semi", unit: "ml", recipe: [{ componentId: sirup, quantity: 100 }] } })).json.id;
    const cycle = await call(fx.app, "PATCH", `/ingredients/${sirup}`, { token: A, body: { recipe: [{ componentId: s2, quantity: 1 }] } });
    expect(cycle.status).toBe(422);
    expect((await call(fx.app, "PATCH", `/ingredients/${sirup}`, { token: A, body: { recipe: [{ componentId: sirup, quantity: 1 }] } })).status).toBe(422);
    expect((await call(fx.app, "DELETE", `/ingredients/${biji}`, { token: A })).status).toBe(409); // dipakai resep
    expect((await call(fx.app, "DELETE", `/ingredients/${s2}`, { token: A })).status).toBe(204);
  });

  it("hak dan isolasi: investor tidak bisa menulis; bisnis lain tidak melihat bahan", async () => {
    expect((await call(fx.app, "POST", "/ingredients", { token: INV, body: { name: "X", unit: "g" } })).status).toBe(403);
    expect((await call(fx.app, "GET", "/ingredients", { token: B })).json.items.map((i: any) => i.id)).not.toContain(biji);
    expect((await call(fx.app, "PUT", `/ingredients/recipes/variants/${kopiVariant}`, { token: B, body: { lines: [] } })).status).toBe(404);
    expect((await call(fx.app, "POST", "/suppliers", { token: INV, body: { name: "Y" } })).status).toBe(403);
  });
});

describe("pembelian (PO), produksi, dan biaya rata-rata", () => {
  it("PO langsung diterima: saldo dan biaya awal; nomor PO berurutan", async () => {
    const po = await inv("POST", "/purchase-orders", {
      outletId: O1(),
      supplierId: supplier,
      fulfill: true,
      lines: [
        { subjectType: "ingredient", subjectId: biji, quantity: 5000, unitCost: 150 },
        { subjectType: "ingredient", subjectId: susu, quantity: 20000, unitCost: 18 },
        { subjectType: "ingredient", subjectId: gula, quantity: 10000, unitCost: 15 },
        { subjectType: "variant", subjectId: airVariant, quantity: 100, unitCost: 2000 },
      ],
    });
    expect(po.status).toBe(201);
    expect(po.json).toMatchObject({ number: 1, status: "completed", total: 750_000 + 360_000 + 150_000 + 200_000 });
    expect(await level(O1(), biji)).toMatchObject({ quantity: 5000, avgCost: 150, value: 750_000 });
    expect(await level(O1(), airVariant)).toMatchObject({ quantity: 100, avgCost: 2000 });
    const second = await inv("POST", "/purchase-orders", { outletId: O1(), lines: [{ subjectType: "ingredient", subjectId: biji, quantity: 5000, unitCost: 250 }] });
    expect(second.json).toMatchObject({ number: 2, status: "waiting" });
  });

  it("penerimaan sebagian lalu sisanya: rata-rata tertimbang; tidak boleh melebihi; PO selesai tak bisa dibatalkan", async () => {
    const list = await inv("GET", `/purchase-orders?outletId=${O1()}&status=waiting`);
    const po = list.json.items[0];
    const detail = await inv("GET", `/purchase-orders/${po.id}`);
    const lineId = detail.json.lines[0].id;
    const part = await inv("POST", `/purchase-orders/${po.id}/fulfill`, { lines: [{ lineId, quantity: 2000 }] });
    expect(part.json.status).toBe("partial");
    expect(await level(O1(), biji)).toMatchObject({ quantity: 7000 });
    expect((await inv("POST", `/purchase-orders/${po.id}/fulfill`, { lines: [{ lineId, quantity: 3001 }] })).status).toBe(422);
    const rest = await inv("POST", `/purchase-orders/${po.id}/fulfill`, {});
    expect(rest.json.status).toBe("completed");
    // (5000 x 150 + 5000 x 250) / 10000 = 200
    expect(await level(O1(), biji)).toMatchObject({ quantity: 10_000, avgCost: 200, value: 2_000_000 });
    expect((await inv("POST", `/purchase-orders/${po.id}/fulfill`, {})).status).toBe(409);
    expect((await inv("POST", `/purchase-orders/${po.id}/cancel`)).status).toBe(409);
    const waiting = await inv("POST", "/purchase-orders", { outletId: O1(), lines: [{ subjectType: "ingredient", subjectId: susu, quantity: 1, unitCost: 1 }] });
    expect((await inv("POST", `/purchase-orders/${waiting.json.id}/cancel`)).json.status).toBe("cancelled");
  });

  it("produksi bahan setengah jadi: bahan terpotong, biaya = nilai bahan / hasil", async () => {
    const res = await inv("POST", "/produce", { outletId: O1(), ingredientId: sirup, batches: 2 });
    expect(res.status).toBe(201);
    // 2 x 600 g gula @15 = 18.000 -> 2.000 ml, Rp 9 per ml
    expect(res.json).toMatchObject({ produced: 2000, unitCost: 9 });
    expect(await level(O1(), gula)).toMatchObject({ quantity: 8800 });
    expect(await level(O1(), sirup)).toMatchObject({ quantity: 2000, avgCost: 9, value: 18_000 });
    expect((await inv("POST", "/produce", { outletId: O1(), ingredientId: biji, batches: 1 })).status).toBe(422); // bukan semi
  });
});

describe("penjualan memotong stok dan menghitung HPP", () => {
  it("2 kopi + extra shot + 1 air: bahan resep, modifier, dan varian terlacak terpotong; HPP dari biaya rata-rata", async () => {
    const order = await bill([sellLine(kopiVariant, 2, [extraShot]), sellLine(airVariant, 1)]);
    expect(order.totals.total).toBe(83_250); // (2 x 35.000 + 5.000) x 1,11
    const paid = await pay(order.id, 100_000);
    expect(paid.status).toBe(200);
    // Biji: 2 x (18 + 9) = 54 g; susu 400 ml; air 1 pcs
    expect(await level(O1(), biji)).toMatchObject({ quantity: 9946 });
    expect(await level(O1(), susu)).toMatchObject({ quantity: 19_600 });
    expect(await level(O1(), airVariant)).toMatchObject({ quantity: 99 });
    // Biaya per kopi: 27 g x 200 + 200 ml x 18 = 9.000; air memakai modal manual 2.000
    const rep = await call(fx.app, "GET", "/reports/summary", { token: A });
    expect(rep.json.metrics).toMatchObject({ cogs: 20_000, netSales: 75_000, grossProfit: 55_000 });
    // Nilai persediaan yang keluar = HPP: 54 x 200 + 400 x 18 + 2.000
    const out = await fx.handle.db.select({ v: sql<string>`SUM(${stockMovements.value})` }).from(stockMovements).where(and(eq(stockMovements.outletId, O1()), eq(stockMovements.kind, "sale")));
    expect(Number(out[0]!.v)).toBe(-20_000);
  });

  it("bayar dua kali tidak memotong stok dua kali", async () => {
    const order = await bill([sellLine(airVariant, 1)]);
    expect((await pay(order.id, 10_000)).status).toBe(200);
    const q = (await level(O1(), airVariant)).quantity;
    expect((await pay(order.id, 10_000)).status).toBe(409);
    expect((await level(O1(), airVariant)).quantity).toBe(q);
  });

  it("mode stok: block menolak, override butuh konfirmasi kasir, off boleh minus", async () => {
    const order = await bill([sellLine(airVariant, 200)]);
    const before = (await level(O1(), airVariant)).quantity;
    await setMode("block");
    const blocked = await pay(order.id, 2_000_000);
    expect(blocked.status).toBe(409);
    expect(blocked.json.extra).toMatchObject({ canOverride: false, short: [expect.objectContaining({ name: expect.stringContaining("Air"), needed: 200 })] });
    expect((await pos("GET", `/orders/${order.id}`)).json.order.status).toBe("open"); // bill tetap terbuka, tidak ada pembayaran setengah jalan
    expect((await level(O1(), airVariant)).quantity).toBe(before);

    await setMode("override");
    const needs = await pay(order.id, 2_000_000);
    expect(needs.status).toBe(409);
    expect(needs.json.extra.canOverride).toBe(true);
    const ok = await pay(order.id, 2_000_000, { stockOverride: true });
    expect(ok.status).toBe(200);
    expect((await level(O1(), airVariant)).quantity).toBe(before - 200);
    await setMode("off");
    const again = await bill([sellLine(airVariant, 5)]);
    expect((await pay(again.id, 100_000)).status).toBe(200); // saldo negatif diizinkan saat mode off
    expect((await level(O1(), airVariant)).quantity).toBe(before - 205);
  });

  it("katalog kasir menampilkan sisa stok item terlacak", async () => {
    const cat = await pos("GET", "/catalog");
    const air = cat.json.items.find((i: any) => i.name === "Air Mineral").variants[0];
    expect(air.stock).toBe((await level(O1(), airVariant)).quantity);
    expect(cat.json.items.find((i: any) => i.name === "Kopi Susu").variants[0].stock).toBeNull();
  });

  it("pembayaran bersamaan tidak kehilangan pemotongan (saldo tepat, rantai saldo konsisten)", async () => {
    await inv("POST", "/adjustments", { outletId: O1(), lines: [{ subjectType: "variant", subjectId: airVariant, actual: 50, unitCost: 2000 }] });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await bill([sellLine(airVariant, 1)])).id);
    const results = await Promise.all(ids.map((id) => pay(id, 10_000)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await level(O1(), airVariant)).quantity).toBe(45);
    const moves = await fx.handle.db.select().from(stockMovements).where(and(eq(stockMovements.outletId, O1()), eq(stockMovements.subjectId, airVariant))).orderBy(stockMovements.createdAt, stockMovements.id);
    let running = 0;
    for (const m of moves) {
      running += m.delta;
      expect(m.balanceAfter).toBe(running); // setiap baris buku besar mencatat saldo yang benar
    }
  });
});

describe("refund dan pengembalian ke stok", () => {
  it("restock bertahap: tanpa restock lalu dengan restock mengembalikan bagian sebanding, bukan semuanya", async () => {
    const order = await bill([sellLine(kopiVariant, 3)]);
    await pay(order.id, 200_000);
    const bijiAfterSale = (await level(O1(), biji)).quantity;
    const detail = (await pos("GET", `/orders/${order.id}`)).json.order;
    const lineId = detail.lines[0].id;
    const r1 = await pos("POST", `/orders/${order.id}/refund`, { lines: [{ lineId, quantity: 1 }], method: "cash", reason: "basi", approval: approval() });
    expect(r1.status).toBe(201);
    expect((await level(O1(), biji)).quantity).toBe(bijiAfterSale); // tanpa restock stok tidak berubah
    const r2 = await pos("POST", `/orders/${order.id}/refund`, { lines: [{ lineId, quantity: 2 }], method: "cash", reason: "salah menu", restock: true, approval: approval() });
    expect(r2.status).toBe(201);
    // 3 unit memakai 54 g biji; 2 unit dikembalikan = 36 g
    expect((await level(O1(), biji)).quantity).toBe(bijiAfterSale + 36_000 / 1000);
    expect((await level(O1(), susu)).quantity).toBe(19_600 - 600 + 400);
    const refunds = await fx.handle.db.select().from(stockMovements).where(and(eq(stockMovements.kind, "refund"), eq(stockMovements.subjectId, biji)));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.unitCost).toBe(200_000); // dikembalikan dengan biaya saat dijual
  });
});

describe("transfer antar outlet", () => {
  it("kirim, terima sebagian (selisih tercatat), batal mengembalikan ke asal; stok tidak cukup ditolak", async () => {
    const before = (await level(O1(), biji)).quantity;
    const send = await inv("POST", "/transfers", { fromOutletId: O1(), toOutletId: O2(), note: "pinjam", lines: [{ subjectType: "ingredient", subjectId: biji, quantity: 1000 }] });
    expect(send.status).toBe(201);
    expect(send.json).toMatchObject({ status: "in_transit", number: 1 });
    expect((await level(O1(), biji)).quantity).toBe(before - 1000);
    expect(await level(O2(), biji)).toMatchObject({ quantity: 0 });

    const lineId = send.json.lines[0].id;
    const recv = await inv("POST", `/transfers/${send.json.id}/receive`, { lines: [{ lineId, quantity: 900 }] });
    expect(recv.json).toMatchObject({ status: "received" });
    expect(recv.json.lines[0]).toMatchObject({ quantity: 1000, receivedQty: 900 });
    expect(await level(O2(), biji)).toMatchObject({ quantity: 900, avgCost: 200 }); // biaya ikut dari asal
    expect((await inv("POST", `/transfers/${send.json.id}/receive`, {})).status).toBe(409);

    const second = await inv("POST", "/transfers", { fromOutletId: O1(), toOutletId: O2(), lines: [{ subjectType: "ingredient", subjectId: biji, quantity: 500 }] });
    const mid = (await level(O1(), biji)).quantity;
    const cancel = await inv("POST", `/transfers/${second.json.id}/cancel`);
    expect(cancel.json.status).toBe("cancelled");
    expect((await level(O1(), biji)).quantity).toBe(mid + 500);

    const tooMuch = await inv("POST", "/transfers", { fromOutletId: O1(), toOutletId: O2(), lines: [{ subjectType: "ingredient", subjectId: biji, quantity: 999_999 }] });
    expect(tooMuch.status).toBe(422);
    expect((await inv("POST", "/transfers", { fromOutletId: O1(), toOutletId: O1(), lines: [{ subjectType: "ingredient", subjectId: biji, quantity: 1 }] })).status).toBe(422);
  });

  it("bisnis lain tidak bisa mengirim ke atau dari outlet kita", async () => {
    const res = await inv("POST", "/transfers", { fromOutletId: fx.b.outletIds[0], toOutletId: O2(), lines: [{ subjectType: "ingredient", subjectId: biji, quantity: 1 }] }, B);
    expect([403, 422]).toContain(res.status);
    expect((await inv("GET", `/stock?outletId=${O1()}`, undefined, B)).status).toBe(403);
  });
});

describe("penyesuaian (stok opname)", () => {
  it("selisih dihitung dari saldo sistem; nilai = selisih x biaya rata-rata; riwayat tercatat", async () => {
    const before = await level(O1(), susu);
    const res = await inv("POST", "/adjustments", { outletId: O1(), note: "opname bulanan", lines: [{ subjectType: "ingredient", subjectId: susu, actual: before.quantity - 800 }] });
    expect(res.status).toBe(201);
    expect(res.json.lines[0]).toMatchObject({ expected: before.quantity, delta: -800, unitCost: 18 });
    expect(res.json.valueChange).toBe(-14_400); // 800 ml x Rp 18
    expect(res.json.number).toBeGreaterThan(0);
    expect(await level(O1(), susu)).toMatchObject({ quantity: before.quantity - 800 });
    const hist = await inv("GET", `/movements?outletId=${O1()}&subjectType=ingredient&subjectId=${susu}`);
    expect(hist.json.items[0]).toMatchObject({ kind: "adjustment", delta: -800, note: "opname bulanan" });
    // hitungan sama dengan saldo: tidak ada pergerakan
    const same = await inv("POST", "/adjustments", { outletId: O1(), lines: [{ subjectType: "ingredient", subjectId: susu, actual: before.quantity - 800 }] });
    expect(same.json.valueChange).toBe(0);
    expect((await inv("POST", "/adjustments", { outletId: O1(), lines: [{ subjectType: "variant", subjectId: kopiVariant, actual: 1 }] })).status).toBe(422); // kopi tidak dilacak
  });

  it("peringatan stok menipis mengikuti batas per outlet", async () => {
    const cur = await level(O1(), susu);
    await inv("PUT", "/stock/alert", { outletId: O1(), subjectType: "ingredient", subjectId: susu, alertLow: cur.quantity + 1 });
    expect((await level(O1(), susu)).status).toBe("low");
    await inv("PUT", "/stock/alert", { outletId: O1(), subjectType: "ingredient", subjectId: susu, alertLow: 0 });
    expect((await level(O1(), susu)).status).toBe("ok");
    const low = await inv("GET", `/stock?outletId=${O1()}&status=out&pageSize=100`);
    expect(low.json.items.every((r: any) => r.status === "out")).toBe(true);
  });
});

describe("ringkasan inventori dan konsistensi buku besar", () => {
  it("awal + pembelian + penjualan + transfer + penyesuaian + produksi = akhir, dan akhir = saldo stok", async () => {
    const res = await call(fx.app, "GET", `/reports/inventory?outletIds=${O1()}`, { token: A });
    expect(res.status).toBe(200);
    for (const r of res.json.rows) {
      expect(r.beginning + r.purchase + r.sales + r.transfer + r.adjustment + r.production).toBeCloseTo(r.ending, 6);
    }
    const bijiRow = res.json.rows.find((r: any) => r.name === "Biji kopi");
    expect(bijiRow).toMatchObject({ beginning: 0, purchase: 10_000, unit: "g" });
    expect(bijiRow.ending).toBe((await level(O1(), biji)).quantity);
    const sirupRow = res.json.rows.find((r: any) => r.name === "Sirup gula");
    expect(sirupRow).toMatchObject({ production: 2000, ending: 2000, value: 18_000 });
    // CSV
    const csv = await fx.app.request(`/api/v1/reports/inventory?format=csv&outletIds=${O1()}`, { headers: { authorization: `Bearer ${A}`, "x-locale": "en" } });
    expect(new TextDecoder().decode(await csv.arrayBuffer()).split("\r\n")[0]).toBe("Name,Unit,Beginning,Purchase,Sales,Transfer,Adjustment,Production,Ending,Value");
  });

  it("invarian: untuk setiap objek, jumlah seluruh pergerakan = saldo, dan rantai saldo tidak patah", async () => {
    const sums = await fx.handle.db
      .select({ outletId: stockMovements.outletId, type: stockMovements.subjectType, id: stockMovements.subjectId, d: sql<string>`SUM(${stockMovements.delta})` })
      .from(stockMovements)
      .groupBy(stockMovements.outletId, stockMovements.subjectType, stockMovements.subjectId);
    expect(sums.length).toBeGreaterThan(5);
    const levels = await fx.handle.db.select().from(stockLevels);
    for (const s of sums) {
      const l = levels.find((x) => x.outletId === s.outletId && x.subjectType === s.type && x.subjectId === s.id);
      expect(l?.quantity).toBe(Number(s.d));
    }
  });
});

void kopiItem;
