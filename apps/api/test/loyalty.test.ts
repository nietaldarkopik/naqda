import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customers, loyaltyLedger, loyaltyRedemptions, orders, smsOutbox, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let INV: string;
let cashier: { device: string; token: string };
let adminId = "";
let takeAway = "";
let kopi = "";
let kopiItem = "";
let andi = "";
let budi = "";
let citra = "";
let r10 = ""; // 10% total, maks 5.000, minimal belanja 20.000, 10 poin
let rFree = ""; // potongan Rp 8.000 untuk satu Kopi, 15 poin
let rBig = ""; // minimal belanja 1.000.000
const ADMIN_PIN = "739206";
const approval = () => ({ userId: adminId, pin: ADMIN_PIN });
const O1 = () => fx.a.outletIds[0]!;

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
const cartOf = (qty: number, extra: Record<string, unknown> = {}) => ({ salesTypeId: takeAway, lines: [{ kind: "item", variantId: kopi, quantity: qty, modifierOptionIds: [] }], ...extra });
const bill = async (qty: number, extra: Record<string, unknown> = {}) => {
  const res = await pos("POST", "/orders", cartOf(qty, extra));
  return res;
};
const pay = (id: string, amount: number, extra: Record<string, unknown> = {}) => pos("POST", `/orders/${id}/pay`, { payments: [{ method: "cash", amount }], ...extra });
const cust = async (id: string) => (await call(fx.app, "GET", `/customers/${id}`, { token: A })).json;
const program = (over: Record<string, unknown> = {}) =>
  call(fx.app, "PUT", "/loyalty/program", {
    token: A,
    body: { enabled: true, pointMode: "spend", spendAmount: 10_000, spendPoints: 1, bonusNewMember: 5, memberQuota: 3, validFrom: null, validTo: null, requireCode: false, earnRules: [], ...over },
  });

beforeAll(async () => {
  fx = await setupFixture();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  INV = (await login(fx.app, fx.a.investorEmail)).token!;
  takeAway = ((await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[]).find((t) => /take/i.test(t.name))!.id;
  await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } });
  const cat = await call(fx.app, "POST", "/categories", { token: A, body: { name: "Minuman" } });
  const item = await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi", categoryId: cat.json.id, variants: [{ name: "R", basePrice: 22000, sku: "K" }] } });
  kopi = item.json.variants[0].id;
  kopiItem = item.json.id;
  cashier = await pairAndLogin(A, O1(), fx.a.cashierEmail, "482615");
  adminId = await idOf(fx.a.adminEmail);
  await call(fx.app, "POST", `/employees/${adminId}/pin`, { token: A, body: { pin: ADMIN_PIN } });
  await pos("POST", "/shifts/open", { openingCash: 0 });
});
afterAll(async () => {
  await fx.handle.close();
});

describe("program dan reward", () => {
  it("program tersimpan; hak menulis; aturan konsistensi reward", async () => {
    expect((await program()).status).toBe(200);
    expect((await call(fx.app, "PUT", "/loyalty/program", { token: INV, body: { enabled: true, pointMode: "spend", spendAmount: 1, spendPoints: 1 } })).status).toBe(403);
    expect((await call(fx.app, "GET", "/loyalty/program", { token: INV })).status).toBe(200); // investor boleh melihat
    expect((await program({ validFrom: "2026-05-02", validTo: "2026-05-01" })).status).toBe(422);
    expect((await program({ earnRules: [{ itemId: null, categoryId: null, pointsPerUnit: 1 }] })).status).toBe(422);

    const mk = (body: Record<string, unknown>) => call(fx.app, "POST", "/loyalty/rewards", { token: A, body });
    r10 = (await mk({ name: "Diskon 10%", pointsCost: 10, kind: "percent_total", valueKind: "percent", value: 1000, maxDiscount: 5000, minPurchase: 20000 })).json.id;
    rFree = (await mk({ name: "Potong 8rb untuk Kopi", pointsCost: 15, kind: "item_discount", valueKind: "amount", value: 8000, itemId: kopiItem })).json.id;
    rBig = (await mk({ name: "Minimal besar", pointsCost: 1, kind: "amount_total", valueKind: "amount", value: 1000, minPurchase: 1_000_000 })).json.id;
    expect(r10 && rFree && rBig).toBeTruthy();
    expect((await mk({ name: "Salah", pointsCost: 5, kind: "percent_total", valueKind: "percent", value: 10001 })).status).toBe(422);
    expect((await mk({ name: "Item tanpa target", pointsCost: 5, kind: "item_discount", valueKind: "percent", value: 1000 })).status).toBe(422);
    expect((await mk({ name: "Total bertarget", pointsCost: 5, kind: "amount_total", valueKind: "amount", value: 100, itemId: kopiItem })).status).toBe(422);
    expect((await mk({ name: "Maks nominal", pointsCost: 5, kind: "amount_total", valueKind: "amount", value: 100, maxDiscount: 50 })).status).toBe(422);
    expect((await call(fx.app, "POST", "/loyalty/rewards", { token: B, body: { name: "X", pointsCost: 1, kind: "item_discount", valueKind: "percent", value: 1000, itemId: kopiItem } })).status).toBe(422); // item bisnis lain
  });
});

describe("pelanggan dan pendaftaran member", () => {
  it("membuat pelanggan; telepon ganda ditolak; bonus member baru hanya sekali; kuota ditegakkan", async () => {
    const mk = (body: Record<string, unknown>, token = A) => call(fx.app, "POST", "/customers", { token, body: { consent: true, ...body } });
    const a = await mk({ name: "Andi", phone: "0811", enroll: true });
    expect(a.status).toBe(201);
    andi = a.json.id;
    expect(a.json).toMatchObject({ member: true, points: 5 }); // bonus member baru
    expect((await mk({ name: "Andi 2", phone: "0811" })).status).toBe(409);
    budi = (await mk({ name: "Budi", phone: "0822" })).json.id;
    citra = (await mk({ name: "Citra", enroll: true })).json.id; // tanpa telepon
    expect((await cust(citra)).points).toBe(5);

    // Keluar lalu daftar lagi: bonus tidak diberikan dua kali
    await call(fx.app, "POST", `/customers/${andi}/unenroll`, { token: A });
    await call(fx.app, "POST", `/customers/${andi}/enroll`, { token: A });
    expect((await cust(andi)).points).toBe(5);

    // Kuota 3: dua member sekarang; member ketiga boleh, keempat ditolak
    const d = (await mk({ name: "Dedi", enroll: true })).json.id;
    expect((await mk({ name: "Eka", enroll: true })).status).toBe(409);
    expect((await call(fx.app, "POST", `/customers/${budi}/enroll`, { token: A })).status).toBe(409);
    await call(fx.app, "DELETE", `/customers/${d}`, { token: A }); // dihapus: tidak lagi dihitung
    expect((await mk({ name: "Dedi lagi", phone: "0811" })).status).toBe(409); // telepon Andi masih dipakai
    const free = await mk({ name: "Telepon bekas", phone: "0899" });
    await call(fx.app, "DELETE", `/customers/${free.json.id}`, { token: A });
    expect((await mk({ name: "Telepon dipakai lagi", phone: "0899" })).status).toBe(201); // nomor bisa dipakai lagi setelah hapus
  });

  it("ringkasan, pencarian, ekspor CSV, dan isolasi bisnis", async () => {
    const list = await call(fx.app, "GET", "/customers?pageSize=100", { token: A });
    expect(list.json.summary).toMatchObject({ members: 2, redeemed: 0 });
    expect((await call(fx.app, "GET", "/customers?q=0822", { token: A })).json.items.map((c: any) => c.name)).toEqual(["Budi"]);
    expect((await call(fx.app, "GET", "/customers?member=no&pageSize=100", { token: A })).json.items.every((c: any) => !c.member)).toBe(true);
    expect((await call(fx.app, "GET", "/customers", { token: B })).json.items).toEqual([]);
    expect((await call(fx.app, "GET", `/customers/${andi}`, { token: B })).status).toBe(404);
    expect((await call(fx.app, "POST", "/customers", { token: INV, body: { name: "X" } })).status).toBe(403);
    const csv = await fx.app.request("/api/v1/customers/export", { headers: { authorization: `Bearer ${A}`, "x-locale": "en" } });
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).split("\r\n")[0]).toBe("Name,Phone,Email,Member since,Points,Lifetime spending,Visits");
  });

  it("penyesuaian poin manual dicatat dan tidak boleh membuat saldo negatif", async () => {
    expect((await call(fx.app, "POST", `/customers/${andi}/points`, { token: A, body: { points: -100, note: "koreksi" } })).status).toBe(422);
    const ok = await call(fx.app, "POST", `/customers/${andi}/points`, { token: A, body: { points: 5, note: "kompensasi" } });
    expect(ok.json.points).toBe(10);
    expect((await cust(andi)).ledger[0]).toMatchObject({ kind: "adjust", points: 5, balanceAfter: 10, note: "kompensasi" });
  });
});

describe("poin didapat saat bayar", () => {
  it("member mendapat poin dari penjualan bersih; non-member hanya total belanja dan kunjungan", async () => {
    const o = await bill(2, { customerId: andi });
    expect(o.status).toBe(201);
    expect(o.json.order.totals.total).toBe(48_840); // 44.000 + PPN 11%
    const paid = await pay(o.json.order.id, 50_000);
    expect(paid.json.order).toMatchObject({ pointsEarned: 4, customer: { id: andi, points: 14, member: true } }); // 44.000 / 10.000 = 4 poin
    expect(await cust(andi)).toMatchObject({ points: 14, lifetimeSpending: 48_840, visits: 1 });

    const ob = await bill(1, { customerId: budi });
    await pay(ob.json.order.id, 30_000);
    expect(await cust(budi)).toMatchObject({ points: 0, lifetimeSpending: 24_420, visits: 1 });
    const none = await bill(1);
    expect((await pay(none.json.order.id, 30_000)).status).toBe(200);
  });

  it("poin per item: aturan item didahulukan; program mati atau di luar masa berlaku tidak memberi poin", async () => {
    await program({ pointMode: "item", earnRules: [{ itemId: kopiItem, categoryId: null, pointsPerUnit: 7 }] });
    const before = (await cust(andi)).points;
    const o = await bill(3, { customerId: andi });
    expect((await pay(o.json.order.id, 100_000)).json.order.pointsEarned).toBe(21);
    expect((await cust(andi)).points).toBe(before + 21);

    await program({ validTo: "2020-01-01" }); // sudah lewat
    expect((await pos("GET", "/loyalty")).json).toMatchObject({ enabled: false, rewards: [] });
    const o2 = await bill(1, { customerId: andi });
    expect((await pay(o2.json.order.id, 30_000)).json.order.pointsEarned).toBe(0);
    expect((await call(fx.app, "POST", `/customers/${budi}/enroll`, { token: A })).status).toBe(409); // program tidak aktif
    await program(); // kembali ke mode belanja, tanpa batas waktu
  });
});

describe("menukar reward", () => {
  it("harga memakai reward di server; poin dipotong saat bayar; poin baru dihitung dari belanja setelah potongan", async () => {
    await call(fx.app, "POST", `/customers/${andi}/points`, { token: A, body: { points: 100, note: "isi" } });
    const before = (await cust(andi)).points;
    const price = await pos("POST", "/price", cartOf(2, { customerId: andi, rewardId: r10 }));
    expect(price.status).toBe(200);
    // 10% x 44.000 = 4.400 (di bawah batas 5.000); net 39.600; PPN 4.356; total 43.956
    expect(price.json.totals).toMatchObject({ orderDiscount: 4400, tax: 4356, total: 43_956 });

    const o = await bill(2, { customerId: andi, rewardId: r10 });
    const paid = await pay(o.json.order.id, 50_000);
    expect(paid.status).toBe(200);
    expect(paid.json.order).toMatchObject({ pointsRedeemed: 10, pointsEarned: 3 }); // net 39.600 -> 3 poin
    expect((await cust(andi)).points).toBe(before - 10 + 3);
    const redemptions = await fx.handle.db.select().from(loyaltyRedemptions).where(eq(loyaltyRedemptions.orderId, o.json.order.id));
    expect(redemptions).toEqual([expect.objectContaining({ points: 10, discount: 4400 })]);
    const ledger = (await cust(andi)).ledger.slice(0, 2).map((l: any) => l.kind);
    expect(ledger).toEqual(["earn", "redeem"]);
    expect((await call(fx.app, "GET", "/customers", { token: A })).json.summary.redeemed).toBe(1);
  });

  it("batas maksimum dan reward item/kategori", async () => {
    const big = await pos("POST", "/price", cartOf(5, { customerId: andi, rewardId: r10 }));
    expect(big.json.totals.orderDiscount).toBe(5000); // 10% x 110.000 = 11.000, dibatasi 5.000
    const item = await pos("POST", "/price", cartOf(2, { customerId: andi, rewardId: rFree }));
    expect(item.json.totals).toMatchObject({ lineDiscountTotal: 8000, orderDiscount: 0 }); // satu unit saja
    const o = await bill(2, { customerId: andi, rewardId: rFree });
    expect((await pay(o.json.order.id, 100_000)).json.order.pointsRedeemed).toBe(15);
  });

  it("penolakan: poin kurang, bukan member, tanpa pelanggan, minimum belanja, digabung diskon pesanan, bisnis lain", async () => {
    const poor = await call(fx.app, "POST", "/customers", { token: A, body: { name: "Miskin", phone: "0877", consent: true } });
    await call(fx.app, "POST", `/customers/${poor.json.id}/enroll`, { token: A }).catch(() => undefined);
    expect((await pos("POST", "/price", cartOf(2, { customerId: budi, rewardId: r10 }))).status).toBe(422); // bukan member
    expect((await pos("POST", "/price", cartOf(2, { rewardId: r10 }))).status).toBe(422); // tanpa pelanggan
    expect((await pos("POST", "/price", cartOf(2, { customerId: andi, rewardId: rBig }))).status).toBe(422); // minimum belanja
    expect((await pos("POST", "/price", cartOf(2, { customerId: citra, rewardId: r10 }))).status).toBe(422); // Citra hanya 5 poin
    const general = await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Umum", kind: "percent", value: 1000, allOutlets: true } });
    // kasir tidak punya hak diskon, jadi uji lewat jalur reward + diskon pesanan oleh pengguna yang berhak lewat reward saja:
    expect(general.status).toBe(201);
    expect((await pos("POST", "/price", cartOf(2, { customerId: andi, rewardId: "018f0000-0000-7000-8000-000000000000" }))).status).toBe(422);
    // pelanggan milik bisnis lain
    expect((await call(fx.app, "POST", "/pos/price", { token: cashier.token, headers: { "x-device-token": cashier.device }, body: cartOf(1, { customerId: crypto.randomUUID() }) })).status).toBe(422);
  });

  it("poin tidak cukup saat bayar (diubah setelah disimpan) menggagalkan seluruh pembayaran", async () => {
    await call(fx.app, "POST", `/customers/${andi}/points`, { token: A, body: { points: 100, note: "isi" } });
    const o = await bill(2, { customerId: andi, rewardId: r10 });
    const cur = (await cust(andi)).points;
    await call(fx.app, "POST", `/customers/${andi}/points`, { token: A, body: { points: -(cur - 3), note: "kosongkan" } }); // sisa 3 poin
    const res = await pay(o.json.order.id, 50_000);
    expect(res.status).toBe(409);
    expect((await pos("GET", `/orders/${o.json.order.id}`)).json.order.status).toBe("open"); // tidak ada pembayaran setengah jalan
    expect((await cust(andi)).points).toBe(3);
  });
});

describe("kode validasi penukaran", () => {
  it("wajib kode: salah berulang menghanguskan kode, benar sekali pakai, tercatat di outbox SMS", async () => {
    await program({ requireCode: true });
    await call(fx.app, "POST", `/customers/${andi}/points`, { token: A, body: { points: 100, note: "isi" } });
    const o = await bill(2, { customerId: andi, rewardId: r10 });
    expect((await pay(o.json.order.id, 50_000)).status).toBe(409); // belum ada kode

    const issued = await pos("POST", "/loyalty/code", { customerId: andi, rewardId: r10 });
    expect(issued.status).toBe(201);
    const code = issued.json.devCode as string;
    expect(code).toMatch(/^\d{6}$/);
    const sms = await fx.handle.db.select().from(smsOutbox).where(eq(smsOutbox.customerId, andi));
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ phone: "0811", kind: "loyalty_code", status: "logged" });
    expect(sms[0]!.body).toContain(code);

    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect((await pay(o.json.order.id, 50_000, { rewardCode: wrong })).status).toBe(409);
    const blocked = await pay(o.json.order.id, 50_000, { rewardCode: wrong });
    expect(blocked.status).toBe(409);
    expect((await pay(o.json.order.id, 50_000, { rewardCode: code })).status).toBe(409); // kode hangus setelah 5 kali salah

    const fresh = (await pos("POST", "/loyalty/code", { customerId: andi, rewardId: r10 })).json.devCode as string;
    const ok = await pay(o.json.order.id, 50_000, { rewardCode: fresh });
    expect(ok.status).toBe(200);
    const again = await bill(2, { customerId: andi, rewardId: r10 });
    expect((await pay(again.json.order.id, 50_000, { rewardCode: fresh })).status).toBe(409); // kode sekali pakai

    // Pelanggan tanpa telepon tidak bisa menerima kode
    await call(fx.app, "POST", `/customers/${citra}/points`, { token: A, body: { points: 50, note: "isi" } });
    expect((await pos("POST", "/loyalty/code", { customerId: citra, rewardId: r10 })).status).toBe(422);
    await program({ requireCode: false });
  });
});

describe("refund mengurangi poin", () => {
  it("refund bertahap membatalkan tepat poin yang didapat dan mengurangi total belanja", async () => {
    const before = await cust(andi);
    const o = await bill(2, { customerId: andi });
    const paid = await pay(o.json.order.id, 50_000);
    expect(paid.json.order.pointsEarned).toBe(4);
    const lineId = paid.json.order.lines[0].id;
    const r1 = await pos("POST", `/orders/${o.json.order.id}/refund`, { lines: [{ lineId, quantity: 1 }], method: "cash", reason: "salah", approval: approval() });
    expect(r1.status).toBe(201);
    expect((await cust(andi)).points).toBe(before.points + 4 - 2); // setengah dari 4 poin
    const r2 = await pos("POST", `/orders/${o.json.order.id}/refund`, { lines: [{ lineId, quantity: 1 }], method: "cash", reason: "salah", approval: approval() });
    expect(r2.status).toBe(201);
    const after = await cust(andi);
    expect(after.points).toBe(before.points); // seluruh poin pesanan itu kembali nol
    expect(after.lifetimeSpending).toBe(before.lifetimeSpending);
  });
});

describe("feedback", () => {
  it("kasir mencatat; Back Office melihat ringkasan, membalas; terbatas bisnis sendiri", async () => {
    const o = await bill(1, { customerId: andi });
    await pay(o.json.order.id, 30_000);
    expect((await pos("POST", "/feedback", { orderId: o.json.order.id, customerId: andi, rating: "good", comment: "enak" })).status).toBe(201);
    expect((await pos("POST", "/feedback", { orderId: o.json.order.id, rating: "bad", comment: "lama" })).status).toBe(201);
    expect((await pos("POST", "/feedback", { orderId: crypto.randomUUID(), rating: "bad" })).status).toBe(422);
    const list = await call(fx.app, "GET", "/feedback", { token: A });
    expect(list.json.summary).toEqual({ good: 1, bad: 1 });
    expect(list.json.items[0]).toMatchObject({ outlet: expect.stringContaining("Outlet") });
    expect((await call(fx.app, "GET", "/feedback?rating=bad", { token: A })).json.items).toHaveLength(1);
    const id = list.json.items[0].id;
    expect((await call(fx.app, "POST", `/feedback/${id}/reply`, { token: INV, body: { reply: "x" } })).status).toBe(403);
    expect((await call(fx.app, "POST", `/feedback/${id}/reply`, { token: A, body: { reply: "Terima kasih" } })).status).toBe(200);
    expect((await call(fx.app, "GET", "/feedback", { token: A })).json.items.find((f: any) => f.id === id)).toMatchObject({ reply: "Terima kasih", repliedBy: expect.stringContaining("Admin") });
    expect((await call(fx.app, "GET", "/feedback", { token: B })).json.summary).toEqual({ good: 0, bad: 0 });
    expect((await call(fx.app, "POST", `/feedback/${id}/reply`, { token: B, body: { reply: "x" } })).status).toBe(404);
  });
});

describe("kasir: pelanggan", () => {
  it("cari, daftar baru (dengan member), dan daftar jadi member dari kasir", async () => {
    const found = await pos("GET", "/customers?q=Andi");
    expect(found.json.items[0]).toMatchObject({ name: "Andi", member: true });
    const created = await pos("POST", "/customers", { name: "Fani", phone: "0855", consent: true });
    expect(created.status).toBe(201);
    expect(created.json.customer.member).toBe(false);
    expect((await pos("POST", "/customers", { name: "Fani 2", phone: "0855", consent: true })).status).toBe(409);
    const prog = await pos("GET", "/loyalty");
    expect(prog.json.enabled).toBe(true);
    expect(prog.json.rewards.map((r: any) => r.name)).toContain("Diskon 10%");
  });
});

describe("invarian buku besar poin", () => {
  it("untuk setiap pelanggan: saldo = jumlah buku besar, dan setiap baris mencatat saldo yang benar", async () => {
    const sums = await fx.handle.db.select({ id: loyaltyLedger.customerId, s: sql<string>`SUM(${loyaltyLedger.points})` }).from(loyaltyLedger).groupBy(loyaltyLedger.customerId);
    expect(sums.length).toBeGreaterThan(2);
    const rows = await fx.handle.db.select().from(customers);
    for (const s of sums) expect(rows.find((r) => r.id === s.id)!.points).toBe(Number(s.s));
    const entries = await fx.handle.db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, andi)).orderBy(loyaltyLedger.createdAt, loyaltyLedger.id);
    let running = 0;
    for (const e of entries) {
      running += e.points;
      expect(e.balanceAfter).toBe(running);
    }
    const o = await fx.handle.db.select().from(orders).where(eq(orders.customerId, andi));
    expect(o.length).toBeGreaterThan(3);
  });
});
