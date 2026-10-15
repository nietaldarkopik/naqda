import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailOutbox, users } from "@naqdi/db";
import { privileges } from "@naqdi/domain";
import { call, login, setupFixture, PASSWORD, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let INV: string;
let cashier: { device: string; token: string };
let takeAway = "";
let kopi = "";
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
const cart = (qty: number) => ({ salesTypeId: takeAway, lines: [{ kind: "item", variantId: kopi, quantity: qty, modifierOptionIds: [] }] });

beforeAll(async () => {
  fx = await setupFixture();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  INV = (await login(fx.app, fx.a.investorEmail)).token!;
  takeAway = ((await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[]).find((t) => /take/i.test(t.name))!.id;
  await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } });
  const g = await call(fx.app, "POST", "/gratuities", { token: A, body: { name: "Service", rateBp: 500, allOutlets: true } });
  await call(fx.app, "PATCH", `/sales-types/${takeAway}`, { token: A, body: { gratuityIds: [g.json.id] } });
  kopi = (await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi", variants: [{ name: "R", basePrice: 20000, sku: "K" }] } })).json.variants[0].id;
  cashier = await pairAndLogin(A, O1(), fx.a.cashierEmail, "482615");
  await pos("POST", "/shifts/open", { openingCash: 0 });
});
afterAll(async () => {
  await fx.handle.close();
});

describe("peran dan hak akses", () => {
  let roleId = "";
  it("membuat peran kustom; konsistensi akses; nama ganda; peran bawaan terkunci", async () => {
    const mk = (body: Record<string, unknown>, token = A) => call(fx.app, "POST", "/roles", { token, body });
    const ok = await mk({ name: "Supervisor", accessType: "app_and_backoffice", privileges: ["backoffice.view", "pos.sell", "pos.void", "pos.refund", "reports.view"] });
    expect(ok.status).toBe(201);
    roleId = ok.json.id;
    expect((await mk({ name: "Tanpa BO", accessType: "backoffice_only", privileges: ["reports.view"] })).status).toBe(422); // butuh backoffice.view
    expect((await mk({ name: "Tanpa jual", accessType: "app_only", privileges: ["shift.manage"] })).status).toBe(422); // butuh pos.sell
    expect((await mk({ name: "supervisor", accessType: "app_only", privileges: ["pos.sell"] })).status).toBe(409);
    expect((await mk({ name: "X", accessType: "app_only", privileges: ["pos.sell", "bukan.hak"] })).status).toBe(422);
    expect((await mk({ name: "Investor baru", accessType: "backoffice_only", privileges: ["backoffice.view"] }, INV)).status).toBe(403);

    const list = await call(fx.app, "GET", "/roles", { token: A });
    const sys = list.json.items.find((r: any) => r.systemKey === "cashier");
    expect(sys.isSystem).toBe(true);
    expect((await call(fx.app, "PATCH", `/roles/${sys.id}`, { token: A, body: { privileges: privileges } })).status).toBe(409);
    expect((await call(fx.app, "DELETE", `/roles/${sys.id}`, { token: A })).status).toBe(409);
    expect(list.json.catalog).toEqual([...privileges]);
  });

  it("mengubah peran; dipakai karyawan tidak bisa dihapus; peran bisnis lain tidak tersentuh", async () => {
    const upd = await call(fx.app, "PATCH", `/roles/${roleId}`, { token: A, body: { privileges: ["backoffice.view", "pos.sell"] } });
    expect(upd.status).toBe(200);
    expect(upd.json.privileges).toEqual(["backoffice.view", "pos.sell"]);
    expect((await call(fx.app, "PATCH", `/roles/${roleId}`, { token: A, body: { accessType: "backoffice_only", privileges: ["pos.sell"] } })).status).toBe(422);
    const emp = await call(fx.app, "POST", "/employees", { token: A, body: { name: "Sup", email: `sup${fx.a.emailSuffix}`, password: PASSWORD, roleId, outletIds: [O1()], status: "active" } });
    expect(emp.status).toBe(201);
    expect((await call(fx.app, "DELETE", `/roles/${roleId}`, { token: A })).status).toBe(409);
    expect((await call(fx.app, "PATCH", `/roles/${roleId}`, { token: B, body: { name: "curang" } })).status).toBe(404);
    await call(fx.app, "DELETE", `/employees/${emp.json.id}`, { token: A });
    expect((await call(fx.app, "DELETE", `/roles/${roleId}`, { token: A })).status).toBe(204);
    expect((await call(fx.app, "GET", "/roles", { token: A })).json.items.map((r: any) => r.id)).not.toContain(roleId);
  });
});

describe("penegakan hak di API (matriks)", () => {
  // Setiap hak diuji dua arah: peran yang HANYA punya hak itu lolos, dan peran yang punya SEMUA hak kecuali itu ditolak.
  const probes: [string, string, string, unknown?][] = [
    ["library.manage", "POST", "/categories", { name: "Kat matriks" }],
    ["inventory.manage", "POST", "/ingredients", { name: "Bahan matriks", unit: "g" }],
    ["customers.manage", "POST", "/customers", { name: "Pelanggan matriks" }],
    ["employees.manage", "GET", "/employees"],
    ["outlets.manage", "POST", "/outlets", { name: "Outlet matriks", assignCatalog: false }],
    ["settings.manage", "GET", "/settings"],
    ["tables.manage", "POST", "/tables/groups", { outletId: "x", name: "Grup" }],
    ["reports.view", "GET", "/reports/summary"],
  ];

  for (const [priv, method, path, body] of probes) {
    it(`${priv}: hanya-hak lolos, semua-kecuali-hak ditolak (${method} ${path})`, async () => {
      const slug = priv.replace(/\W/g, "");
      const onlyRole = await call(fx.app, "POST", "/roles", { token: A, body: { name: `Hanya ${priv}`, accessType: "backoffice_only", privileges: [...new Set(["backoffice.view", priv])] } });
      const allBut = privileges.filter((p) => p !== priv);
      const exceptRole = await call(fx.app, "POST", "/roles", { token: A, body: { name: `Semua kecuali ${priv}`, accessType: "backoffice_only", privileges: allBut } });
      expect([onlyRole.status, exceptRole.status]).toEqual([201, 201]);
      const mkUser = async (role: string, label: string) => {
        const email = `${label}-${slug}${fx.a.emailSuffix}`;
        const r = await call(fx.app, "POST", "/employees", { token: A, body: { name: label, email, password: PASSWORD, roleId: role, outletIds: [O1()], status: "active" } });
        expect(r.status).toBe(201);
        return (await login(fx.app, email)).token!;
      };
      const only = await mkUser(onlyRole.json.id, "only");
      const except = await mkUser(exceptRole.json.id, "except");
      const fix = (b: unknown) => (b && typeof b === "object" && "outletId" in b ? { ...(b as object), outletId: O1() } : b);
      const allowed = await call(fx.app, method, path, { token: only, body: fix(body) });
      const denied = await call(fx.app, method, path, { token: except, body: fix(body) });
      expect(allowed.status, `hanya ${priv} harus lolos`).not.toBe(403);
      expect(allowed.status).not.toBe(401);
      expect(denied.status, `tanpa ${priv} harus ditolak`).toBe(403);
    });
  }

  it("kasir app-only tidak bisa masuk Back Office dan tidak bisa membuka API Back Office dengan token POS", async () => {
    expect((await login(fx.app, fx.a.cashierEmail)).token).toBeUndefined();
    expect((await call(fx.app, "GET", "/reports/summary", { token: cashier.token })).status).toBe(401);
  });

  it("hak POS dibaca dari peran SAAT INI: perubahan peran langsung berlaku di sesi kasir yang sedang berjalan", async () => {
    expect((await pos("GET", "/shifts/current")).status).toBe(200);
    const cashierRole = await call(fx.app, "POST", "/roles", { token: A, body: { name: "Kasir tanpa shift", accessType: "app_only", privileges: ["pos.sell"] } });
    const uid = await idOf(fx.a.cashierEmail);
    await fx.handle.db.update(users).set({ roleId: cashierRole.json.id }).where(eq(users.id, uid));
    // token yang sama, hak berubah
    expect((await pos("POST", "/shifts/open", { openingCash: 0 })).status).toBe(403);
    // peran dipindah ke akses back office saja: sesi kasir langsung tidak berlaku
    const boOnly = await call(fx.app, "POST", "/roles", { token: A, body: { name: "BO saja", accessType: "backoffice_only", privileges: ["backoffice.view"] } });
    await fx.handle.db.update(users).set({ roleId: boOnly.json.id }).where(eq(users.id, uid));
    expect((await pos("GET", "/shifts/current")).status).toBe(401);
    // kembalikan
    const original = (await call(fx.app, "GET", "/roles", { token: A })).json.items.find((r: any) => r.systemKey === "cashier").id;
    await fx.handle.db.update(users).set({ roleId: original }).where(eq(users.id, uid));
    expect((await pos("GET", "/shifts/current")).status).toBe(200);
  });
});

describe("pengaturan checkout", () => {
  it("nilai bawaan, validasi, dan hak", async () => {
    const s = await call(fx.app, "GET", "/settings", { token: A });
    expect(s.json.checkout).toEqual({ taxEnabled: true, gratuityEnabled: true, allowSplitPayment: true });
    expect(s.json.receipt).toMatchObject({ paperMm: 80, footerText: null, showTaxBreakdown: true });
    expect((await call(fx.app, "GET", "/settings", { token: INV })).status).toBe(403);
    expect((await call(fx.app, "PUT", "/settings/checkout", { token: A, body: { taxEnabled: "ya" } })).status).toBe(422);
    expect((await call(fx.app, "PUT", "/settings/tidakada", { token: A, body: {} })).status).toBe(422);
  });

  it("pajak dan service bisa dimatikan; pisah bayar bisa dilarang", async () => {
    const price = async () => (await pos("POST", "/price", cart(2))).json.totals;
    expect(await price()).toMatchObject({ gratuity: 2000, tax: 4620, total: 46_620 }); // 40.000 + service 5% + PPN 11% atas keduanya
    await call(fx.app, "PUT", "/settings/checkout", { token: A, body: { taxEnabled: false, gratuityEnabled: true, allowSplitPayment: true } });
    expect(await price()).toMatchObject({ gratuity: 2000, tax: 0, total: 42_000 });
    await call(fx.app, "PUT", "/settings/checkout", { token: A, body: { taxEnabled: true, gratuityEnabled: false, allowSplitPayment: true } });
    expect(await price()).toMatchObject({ gratuity: 0, tax: 4400, total: 44_400 });
    await call(fx.app, "PUT", "/settings/checkout", { token: A, body: { taxEnabled: false, gratuityEnabled: false, allowSplitPayment: false } });
    expect(await price()).toMatchObject({ gratuity: 0, tax: 0, total: 40_000 });

    const order = (await pos("POST", "/orders", cart(2))).json.order;
    const split = await pos("POST", `/orders/${order.id}/pay`, { payments: [{ method: "card", amount: 10_000 }, { method: "cash", amount: 30_000 }] });
    expect(split.status).toBe(422);
    expect((await pos("POST", `/orders/${order.id}/pay`, { payments: [{ method: "cash", amount: 40_000 }] })).status).toBe(200);
    await call(fx.app, "PUT", "/settings/checkout", { token: A, body: { taxEnabled: true, gratuityEnabled: true, allowSplitPayment: true } });
    expect(await price()).toMatchObject({ total: 46_620 });
  });
});

describe("metode pembayaran", () => {
  let gopay = "";
  it("lima metode bawaan; metode kustom; kas tidak bisa dimatikan; bawaan tidak bisa dihapus", async () => {
    const s = await call(fx.app, "GET", "/settings", { token: A });
    expect(s.json.paymentMethods.map((m: any) => m.key)).toEqual(["cash", "card", "qris", "ewallet", "transfer"]);
    const created = await call(fx.app, "POST", "/settings/payment-methods", { token: A, body: { name: "GoPay" } });
    expect(created.status).toBe(201);
    gopay = created.json.key;
    expect(created.json).toMatchObject({ name: "GoPay", isSystem: false, enabled: true });
    expect((await call(fx.app, "POST", "/settings/payment-methods", { token: A, body: { name: "gopay" } })).status).toBe(409);
    const cash = s.json.paymentMethods.find((m: any) => m.key === "cash");
    expect((await call(fx.app, "PATCH", `/settings/payment-methods/${cash.id}`, { token: A, body: { enabled: false } })).status).toBe(422);
    expect((await call(fx.app, "DELETE", `/settings/payment-methods/${cash.id}`, { token: A })).status).toBe(409);
    expect((await call(fx.app, "POST", "/settings/payment-methods", { token: INV, body: { name: "X" } })).status).toBe(403);
  });

  it("kasir hanya melihat metode yang aktif di outletnya dan hanya boleh membayar dengan metode itu", async () => {
    const list = async () => (await pos("GET", "/settings")).json.paymentMethods.map((m: any) => m.key);
    expect(await list()).toContain(gopay);
    const methods = (await call(fx.app, "GET", "/settings", { token: A })).json.paymentMethods;
    const card = methods.find((m: any) => m.key === "card");
    await call(fx.app, "PATCH", `/settings/payment-methods/${card.id}`, { token: A, body: { enabled: false } });
    expect(await list()).not.toContain("card");

    const order = (await pos("POST", "/orders", cart(1))).json.order;
    const total = order.totals.total as number;
    expect((await pos("POST", `/orders/${order.id}/pay`, { payments: [{ method: "card", amount: total }] })).status).toBe(422);
    expect((await pos("POST", `/orders/${order.id}/pay`, { payments: [{ method: "tidakada", amount: total }] })).status).toBe(422);
    // metode kustom non-tunai tidak boleh melebihi tagihan (tidak ada kembalian)
    expect((await pos("POST", `/orders/${order.id}/pay`, { payments: [{ method: gopay, amount: total + 1000 }] })).status).toBe(422);
    expect((await pos("POST", `/orders/${order.id}/pay`, { payments: [{ method: gopay, amount: total, reference: "TRX1" }] })).status).toBe(200);

    // dibatasi ke outlet lain: hilang dari outlet ini
    const gp = methods.find((m: any) => m.key === gopay);
    await call(fx.app, "PATCH", `/settings/payment-methods/${gp.id}`, { token: A, body: { outletIds: [fx.a.outletIds[1]] } });
    expect(await list()).not.toContain(gopay);
    await call(fx.app, "PATCH", `/settings/payment-methods/${gp.id}`, { token: A, body: { outletIds: [] } });
    expect(await list()).toContain(gopay);
    expect((await call(fx.app, "PATCH", `/settings/payment-methods/${gp.id}`, { token: A, body: { outletIds: [fx.b.outletIds[0]] } })).status).toBe(422); // outlet bisnis lain
    await call(fx.app, "PATCH", `/settings/payment-methods/${card.id}`, { token: A, body: { enabled: true } });
  });

  it("laporan pembayaran memakai nama metode kustom; metode kustom bisa dihapus tanpa merusak riwayat", async () => {
    const rep = await call(fx.app, "GET", "/reports/payments", { token: A });
    expect(rep.json.rows.find((r: any) => r.method === gopay)).toMatchObject({ name: "GoPay", collected: expect.any(Number) });
    const gp = (await call(fx.app, "GET", "/settings", { token: A })).json.paymentMethods.find((m: any) => m.key === gopay);
    expect((await call(fx.app, "DELETE", `/settings/payment-methods/${gp.id}`, { token: A })).status).toBe(204);
    expect((await pos("GET", "/settings")).json.paymentMethods.map((m: any) => m.key)).not.toContain(gopay);
    const after = await call(fx.app, "GET", "/reports/payments", { token: A });
    expect(after.json.rows.find((r: any) => r.method === gopay)?.name).toBe("GoPay"); // riwayat tetap bernama
  });
});

describe("desain struk, notifikasi, dan slot karyawan", () => {
  it("desain struk tersimpan dan sampai ke kasir", async () => {
    const body = { headerText: "Selamat datang\nBuka 08.00-22.00", showOutletName: true, showOutletAddress: false, showOutletPhone: true, website: "naqdi.example", instagram: "@naqdi", footerText: "Sampai jumpa", showCashier: false, showTable: true, showCustomer: true, showTaxBreakdown: false, paperMm: 58 };
    expect((await call(fx.app, "PUT", "/settings/receipt", { token: A, body })).status).toBe(200);
    const s = (await pos("GET", "/settings")).json;
    expect(s.receipt).toMatchObject({ paperMm: 58, footerText: "Sampai jumpa", showCashier: false, instagram: "@naqdi" });
    expect(s.outlet.name).toContain("Outlet");
    expect((await call(fx.app, "PUT", "/settings/receipt", { token: A, body: { ...body, paperMm: 70 } })).status).toBe(422);
  });

  it("notifikasi: penerima divalidasi; contoh ringkasan dicatat di outbox (tidak dikirim)", async () => {
    expect((await call(fx.app, "POST", "/settings/notifications/test", { token: A })).status).toBe(422); // belum ada penerima
    expect((await call(fx.app, "PUT", "/settings/notifications", { token: A, body: { dailySummary: true, lowStock: true, recipients: ["bukan-email"] } })).status).toBe(422);
    expect((await call(fx.app, "PUT", "/settings/notifications", { token: A, body: { dailySummary: true, lowStock: false, recipients: ["Owner@Toko.test", "gm@toko.test"] } })).status).toBe(200);
    const res = await call(fx.app, "POST", "/settings/notifications/test", { token: A });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ delivered: false, recipients: ["owner@toko.test", "gm@toko.test"] });
    const rows = await fx.handle.db.select().from(emailOutbox);
    const mine = rows.filter((r) => r.recipient.endsWith("@toko.test"));
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ kind: "daily_summary", status: "logged" });
    expect(mine[0]!.body).toContain("Transaksi:");
  });

  it("slot karyawan: pembuatan dan pengaktifan ulang ditolak saat penuh", async () => {
    const employees = await call(fx.app, "GET", "/employees?pageSize=100", { token: A });
    const active = employees.json.items.filter((e: any) => e.status !== "inactive").length;
    expect((await call(fx.app, "PUT", "/settings/account", { token: A, body: { employeeSlots: active } })).status).toBe(200);
    const mk = (status: string, n: string) => call(fx.app, "POST", "/employees", { token: A, body: { name: n, email: `${n}${fx.a.emailSuffix}`, password: PASSWORD, roleId: fx.a.roleIds.investor, outletIds: [O1()], status } });
    const full = await mk("active", "slotpenuh");
    expect(full.status).toBe(409);
    const idle = await mk("inactive", "slotnonaktif"); // nonaktif tidak memakai slot
    expect(idle.status).toBe(201);
    expect((await call(fx.app, "PATCH", `/employees/${idle.json.id}`, { token: A, body: { status: "active" } })).status).toBe(409);
    await call(fx.app, "PUT", "/settings/account", { token: A, body: { employeeSlots: active + 1 } });
    expect((await call(fx.app, "PATCH", `/employees/${idle.json.id}`, { token: A, body: { status: "active" } })).status).toBe(200);
    expect((await mk("active", "lagi")).status).toBe(409);
    await call(fx.app, "PUT", "/settings/account", { token: A, body: { employeeSlots: null } });
    expect((await mk("active", "lagi2")).status).toBe(201);
  });

  it("pengaturan terisolasi per bisnis", async () => {
    expect((await call(fx.app, "GET", "/settings", { token: B })).json.receipt.paperMm).toBe(80);
    expect((await call(fx.app, "GET", "/settings", { token: B })).json.notifications.recipients).toEqual([]);
  });
});
