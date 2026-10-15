import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let MGR: string; // regionalManager: tables.manage, bukan pengguna kasir
let INV: string; // investor: reports.view saja
let cashier: { device: string; token: string };
let admin: { device: string; token: string };
let adminId = "";
let takeAway = "";
let kopi = "";
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
  expect(res.status).toBe(200);
  return { device, token: res.json.accessToken as string };
};
const pos = (who: { device: string; token: string }, method: string, path: string, body?: unknown) =>
  call(fx.app, method, `/pos${path}`, { token: who.token, headers: { "x-device-token": who.device }, body });
const kopiLine = (qty: number) => ({ kind: "item", variantId: kopi, quantity: qty, modifierOptionIds: [] });
const cart = (lines: unknown[], extra: Record<string, unknown> = {}) => ({ salesTypeId: takeAway, lines, ...extra });

const O1 = () => fx.a.outletIds[0]!;

beforeAll(async () => {
  fx = await setupFixture();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  MGR = (await login(fx.app, fx.a.managerEmail)).token!;
  INV = (await login(fx.app, fx.a.investorEmail)).token!;
  const types = (await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[];
  takeAway = types.find((t) => /take/i.test(t.name))!.id;
  await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } });
  const k = await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi", variants: [{ name: "R", basePrice: 22000, sku: "KOPI" }] } });
  kopi = k.json.variants[0].id;
  cashier = await pairAndLogin(A, O1(), fx.a.cashierEmail, "482615");
  admin = await pairAndLogin(A, O1(), fx.a.adminEmail, ADMIN_PIN);
  adminId = await idOf(fx.a.adminEmail);
  expect((await pos(cashier, "POST", "/shifts/open", { openingCash: 100000 })).status).toBe(201);
  expect((await pos(admin, "POST", "/shifts/open", { openingCash: 0 })).status).toBe(201);
});
afterAll(async () => {
  await fx.handle.close();
});

describe("meja dan grup (Back Office)", () => {
  let groupId = "";
  let t1 = "";
  let t2 = "";

  it("membuat grup dan meja; nama ganda dan outlet asing ditolak", async () => {
    const g = await call(fx.app, "POST", "/tables/groups", { token: A, body: { outletId: O1(), name: "Indoor" } });
    expect(g.status).toBe(201);
    groupId = g.json.id;
    expect((await call(fx.app, "POST", "/tables/groups", { token: A, body: { outletId: O1(), name: "Indoor" } })).status).toBe(409);
    const a = await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), groupId, name: "M1", capacity: 4, x: 1, y: 1 } });
    const b = await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), name: "M2", x: 5, y: 1 } });
    expect([a.status, b.status]).toEqual([201, 201]);
    t1 = a.json.id;
    t2 = b.json.id;
    expect((await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), name: "M1" } })).status).toBe(409);
    expect((await call(fx.app, "POST", "/tables", { token: A, body: { outletId: fx.b.outletIds[0], name: "X" } })).status).toBe(422); // outlet bisnis lain
    expect((await call(fx.app, "POST", "/tables", { token: B, body: { outletId: O1(), name: "X" } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), groupId: "018f0000-0000-7000-8000-000000000000", name: "Y" } })).status).toBe(422);
  });

  it("simpan posisi denah sekaligus; hak tables.manage; tenant lain tak bisa menyentuh", async () => {
    const saved = await call(fx.app, "PUT", "/tables/layout", { token: MGR, body: { outletId: O1(), items: [{ id: t1, x: 10, y: 3 }, { id: t2, x: 12, y: 3 }] } });
    expect(saved.status).toBe(200);
    const list = await call(fx.app, "GET", `/tables?outletId=${O1()}`, { token: A });
    expect(list.json.items.find((t: any) => t.id === t1)).toMatchObject({ x: 10, y: 3, groupId });
    expect((await call(fx.app, "GET", `/tables?outletId=${O1()}`, { token: INV })).status).toBe(403);
    expect((await call(fx.app, "PUT", "/tables/layout", { token: B, body: { outletId: fx.b.outletIds[0], items: [{ id: t1, x: 0, y: 0 }] } })).status).toBe(422);
    expect((await call(fx.app, "PATCH", `/tables/${t1}`, { token: B, body: { name: "curang" } })).status).toBe(404);
  });

  it("meja dengan bill terbuka tidak bisa dihapus; menghapus grup melepas mejanya", async () => {
    const bill = await pos(cashier, "POST", "/orders", cart([kopiLine(1)], { tableId: t2 }));
    expect(bill.status).toBe(201);
    expect((await call(fx.app, "DELETE", `/tables/${t2}`, { token: A })).status).toBe(409);
    expect((await call(fx.app, "DELETE", `/tables/groups/${groupId}`, { token: A })).status).toBe(204);
    const list = await call(fx.app, "GET", `/tables?outletId=${O1()}`, { token: A });
    expect(list.json.items.find((t: any) => t.id === t1).groupId).toBeNull();
    await pos(cashier, "POST", `/orders/${bill.json.order.id}/void`, { reason: "uji", approval: approval() });
    expect((await call(fx.app, "DELETE", `/tables/${t2}`, { token: A })).status).toBe(204);
  });
});

describe("meja di kasir", () => {
  let table = "";
  it("bill di meja muncul di denah; meja milik outlet lain atau terhapus ditolak; pindah meja tercatat", async () => {
    const t = await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), name: "T-Kasir", x: 2, y: 2 } });
    table = t.json.id;
    const other = await call(fx.app, "POST", "/tables", { token: A, body: { outletId: O1(), name: "T-Lain", x: 4, y: 2 } });
    const bill = await pos(cashier, "POST", "/orders", cart([kopiLine(2)], { tableId: table }));
    expect(bill.json.order.tableId).toBe(table);

    const map = await pos(cashier, "GET", "/tables");
    const entry = map.json.tables.find((x: any) => x.id === table);
    expect(entry.open).toMatchObject({ count: 1, total: bill.json.order.totals.total });
    expect(map.json.tables.find((x: any) => x.id === other.json.id).open).toBeNull();

    const byTable = await pos(cashier, "GET", `/orders?status=open&tableId=${table}`);
    expect(byTable.json.items.map((o: any) => o.id)).toEqual([bill.json.order.id]);
    expect(byTable.json.items[0].tableName).toBe("T-Kasir");

    // Meja outlet bisnis lain
    const foreign = await call(fx.app, "POST", "/tables", { token: B, body: { outletId: fx.b.outletIds[0], name: "B1" } });
    expect((await pos(cashier, "POST", "/orders", cart([kopiLine(1)], { tableId: foreign.json.id }))).status).toBe(422);

    // Pindah meja
    const moved = await pos(cashier, "PUT", `/orders/${bill.json.order.id}`, cart([kopiLine(2)], { tableId: other.json.id }));
    expect(moved.json.order.tableId).toBe(other.json.id);
    const acts = await call(fx.app, "GET", `/activities?outletId=${O1()}&kind=table_changed`, { token: A });
    expect(acts.json.items.length).toBeGreaterThan(0);
  });
});

describe("persetujuan atasan", () => {
  it("daftar atasan: punya hak dan PIN, bukan diri sendiri", async () => {
    const res = await pos(cashier, "GET", "/approvers?privilege=pos.void");
    expect(res.json.items.map((u: any) => u.id)).toEqual([adminId]);
    expect((await pos(admin, "GET", "/approvers?privilege=pos.void")).json.items).toEqual([]);
  });

  it("PIN atasan salah dibalas 403 tanpa mengeluarkan kasir dari sesinya; kasir tidak bisa menyetujui diri sendiri", async () => {
    const bill = await pos(cashier, "POST", "/orders", cart([kopiLine(2)]));
    const id = bill.json.order.id as string;
    const wrong = await pos(cashier, "PUT", `/orders/${id}`, { ...cart([kopiLine(1)]), reason: "x", approval: { userId: adminId, pin: "000999" } });
    expect(wrong.status).toBe(403);
    expect((await pos(cashier, "GET", "/shifts/current")).status).toBe(200); // sesi kasir masih berlaku
    const selfId = await idOf(fx.a.cashierEmail);
    const self = await pos(cashier, "PUT", `/orders/${id}`, { ...cart([kopiLine(1)]), reason: "x", approval: { userId: selfId, pin: "482615" } });
    expect(self.status).toBe(403); // kasir tidak punya pos.void
    // Alasan wajib
    const noReason = await pos(cashier, "PUT", `/orders/${id}`, { ...cart([kopiLine(1)]), approval: approval() });
    expect(noReason.status).toBe(422);
    // Menambah baris tidak butuh persetujuan
    expect((await pos(cashier, "PUT", `/orders/${id}`, cart([kopiLine(3)]))).status).toBe(200);
    // Mengurangi dengan persetujuan + alasan: tercatat beserta penyetujunya
    const ok = await pos(cashier, "PUT", `/orders/${id}`, { ...cart([kopiLine(1)]), reason: "pelanggan batal", approval: approval() });
    expect(ok.status).toBe(200);
    const acts = await call(fx.app, "GET", `/activities?outletId=${O1()}&kind=item_removed`, { token: A });
    const mine = acts.json.items.find((a: any) => a.orderId === id);
    expect(mine).toMatchObject({ approvedBy: expect.stringContaining("Admin"), detail: { reason: "pelanggan batal", items: [{ quantity: 2 }] } });
  });
});

describe("refund", () => {
  let orderId = "";
  let total = 0;
  const pay = async (qty: number, method = "cash") => {
    const bill = await pos(cashier, "POST", "/orders", cart([kopiLine(qty)]));
    const id = bill.json.order.id as string;
    const t = bill.json.order.totals.total as number;
    const paid = await pos(cashier, "POST", `/orders/${id}/pay`, { payments: [{ method, amount: method === "cash" ? t + 1000 : t }] });
    expect(paid.status).toBe(200);
    return { id, total: t, order: paid.json.order };
  };

  it("kasir tanpa pos.refund butuh persetujuan; bill belum lunas atau metode asing ditolak", async () => {
    const p = await pay(3);
    orderId = p.id;
    total = p.total;
    expect(total).toBe(73260); // 3 x 22.000 + PPN 11%
    const line = p.order.lines[0].id as string;
    const body = { lines: [{ lineId: line, quantity: 1 }], method: "cash", reason: "salah menu" };
    const denied = await pos(cashier, "POST", `/orders/${orderId}/refund`, body);
    expect(denied.status).toBe(403);
    expect(denied.json.extra.required).toBe("pos.refund");
    expect((await pos(cashier, "POST", `/orders/${orderId}/refund`, { ...body, method: "card", approval: approval() })).status).toBe(422);
    const open = await pos(cashier, "POST", "/orders", cart([kopiLine(1)]));
    expect((await pos(cashier, "POST", `/orders/${open.json.order.id}/refund`, { ...body, lines: [{ lineId: open.json.order.lines[0].id, quantity: 1 }], approval: approval() })).status).toBe(409);
  });

  it("refund sebagian lalu sisanya: jumlah tepat, laci shift berkurang, tidak bisa melebihi", async () => {
    const before = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    const detail = (await pos(cashier, "GET", `/orders/${orderId}`)).json.order;
    const line = detail.lines[0].id as string;

    const first = await pos(cashier, "POST", `/orders/${orderId}/refund`, { lines: [{ lineId: line, quantity: 1 }], method: "cash", reason: "salah menu", approval: approval() });
    expect(first.status).toBe(201);
    expect(first.json.refund.total).toBe(24420); // 73.260 / 3
    expect(first.json.order).toMatchObject({ refundedTotal: 24420, status: "paid" });
    expect(first.json.order.lines[0].refundedQuantity).toBe(1);

    const mid = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    expect(mid.cashRefunds).toBe(24420);
    expect(mid.expectedCash).toBe(before.expectedCash - 24420);

    const tooMany = await pos(cashier, "POST", `/orders/${orderId}/refund`, { lines: [{ lineId: line, quantity: 3 }], method: "cash", reason: "x", approval: approval() });
    expect(tooMany.status).toBe(422);

    const rest = await pos(cashier, "POST", `/orders/${orderId}/refund`, { lines: [{ lineId: line, quantity: 2 }], method: "cash", reason: "batal semua", approval: approval() });
    expect(rest.json.refund.total).toBe(total - 24420);
    expect(rest.json.order.refundedTotal).toBe(total); // tidak ada selisih satu satuan pun
    expect((await pos(cashier, "POST", `/orders/${orderId}/refund`, { lines: [{ lineId: line, quantity: 1 }], method: "cash", reason: "lagi", approval: approval() })).status).toBe(422);
  });

  it("refund non-tunai tidak mengurangi laci; dicatat di aktivitas dengan penyetuju", async () => {
    const p = await pay(1, "card");
    const before = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    const res = await pos(cashier, "POST", `/orders/${p.id}/refund`, { lines: [{ lineId: p.order.lines[0].id, quantity: 1 }], method: "card", reason: "kartu salah gesek", approval: approval() });
    expect(res.status).toBe(201);
    const after = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    expect(after.expectedCash).toBe(before.expectedCash);
    const acts = await call(fx.app, "GET", `/activities?outletId=${O1()}&kind=refund`, { token: INV });
    expect(acts.status).toBe(200);
    expect(acts.json.items.length).toBeGreaterThanOrEqual(3);
    expect(acts.json.items[0]).toMatchObject({ user: expect.stringContaining("Kasir"), approvedBy: expect.stringContaining("Admin") });
  });

  it("refund tunai tidak boleh melebihi uang di laci", async () => {
    const p = await pay(1, "cash");
    // Kas keluar hampir semua isi laci admin (shift lain), lalu kasir kedua tidak punya uang cukup
    const sum = (await pos(admin, "GET", "/shifts/current")).json.shift;
    expect(sum.expectedCash).toBe(0);
    const res = await pos(admin, "POST", `/orders/${p.id}/refund`, { lines: [{ lineId: p.order.lines[0].id, quantity: 1 }], method: "cash", reason: "laci kosong" });
    expect(res.status).toBe(422); // laci shift admin Rp 0
  });

  it("aktivitas hanya terlihat oleh bisnis sendiri", async () => {
    const mine = await call(fx.app, "GET", "/activities?pageSize=100", { token: A });
    expect(mine.json.total).toBeGreaterThan(5);
    const theirs = await call(fx.app, "GET", "/activities?pageSize=100", { token: B });
    expect(theirs.json.total).toBe(0);
  });
});
