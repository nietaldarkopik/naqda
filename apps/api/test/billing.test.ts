import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businesses, createBusiness, users } from "@naqdi/db";
import { GRACE_DAYS, trialEndFrom } from "@naqdi/domain";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
const DAY = 86_400_000;

const setBilling = (businessId: string, patch: Partial<typeof businesses.$inferInsert>) => fx.handle.db.update(businesses).set(patch).where(eq(businesses.id, businessId));

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
});
afterAll(async () => {
  await fx.handle.close();
});

/** Bisnis baru berpaket "basic" dan masa uji coba, lengkap dengan perangkat kasir yang sudah masuk. */
const makeTrialBusiness = async (label: string, plan = "basic") => {
  const email = `${label}-${Date.now().toString(36)}@billing.test`;
  const made = await createBusiness(fx.handle.db, { name: `Toko ${label}`, currency: "IDR", adminEmail: email, adminPassword: "KataSandiKuat1!", bcryptCost: 4, plan, status: "trial", trialEndsAt: trialEndFrom(new Date()) });
  const token = (await login(fx.app, email, "KataSandiKuat1!")).token!;
  return { ...made, token };
};

const posSession = async (b: { token: string; outletId: string; userId: string }) => {
  await call(fx.app, "POST", `/employees/${b.userId}/pin`, { token: b.token, body: { pin: "739206" } });
  const dev = await call(fx.app, "POST", "/devices", { token: b.token, body: { outletId: b.outletId, name: "Kasir" } });
  expect(dev.status).toBe(201);
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: dev.json.activationCode } });
  const device = act.json.deviceToken as string;
  const s = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: b.userId, pin: "739206" } });
  return (method: string, path: string, body?: unknown) => call(fx.app, method, `/pos${path}`, { token: s.json.accessToken, headers: { "x-device-token": device }, body });
};

describe("status langganan terlihat oleh klien", () => {
  it("/me dan login membawa status, sisa hari, paket, dan batas", async () => {
    const b = await makeTrialBusiness("tampil");
    const me = await call(fx.app, "GET", "/me", { token: b.token });
    expect(me.json.business.billing).toMatchObject({ status: "trial", level: "full", reason: "trial", plan: "basic", daysLeft: 14 });
    expect(me.json.business.billing.limits).toMatchObject({ maxOutlets: 1, maxDevices: 2, maxEmployees: 10 });
    const lg = await call(fx.app, "POST", "/auth/login", { body: { email: b.email, password: "KataSandiKuat1!" } });
    expect(lg.json.business.billing.status).toBe("trial");
  });

  it("bisnis lama dan bisnis uji (tanpa pengaturan khusus) aktif tanpa batas", async () => {
    const A = (await login(fx.app, fx.a.adminEmail)).token!;
    const me = await call(fx.app, "GET", "/me", { token: A });
    expect(me.json.business.billing).toMatchObject({ status: "active", level: "full", plan: "unlimited", daysLeft: null });
  });
});

describe("terkunci: Back Office hanya-baca", () => {
  it("uji coba habis lewat masa tenggang: baca boleh, ubah ditolak 402; dalam tenggang tetap penuh", async () => {
    const b = await makeTrialBusiness("kunci");
    // masa tenggang: sudah lewat sehari dari akhir uji coba
    await setBilling(b.businessId, { trialEndsAt: new Date(Date.now() - DAY) });
    const grace = await call(fx.app, "GET", "/me", { token: b.token });
    expect(grace.json.business.billing).toMatchObject({ level: "grace", reason: "trial_expired" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Masih Bisa" } })).status).toBe(201);

    // lewat masa tenggang: terkunci
    await setBilling(b.businessId, { trialEndsAt: new Date(Date.now() - (GRACE_DAYS + 1) * DAY) });
    const blocked = await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Ditolak" } });
    expect(blocked.status).toBe(402);
    expect(blocked.json).toMatchObject({ code: "payment_required", extra: { reason: "trial_expired" } });
    expect(blocked.json.message).toMatch(/Langganan/i);
    expect((await call(fx.app, "PATCH", `/outlets/${b.outletId}`, { token: b.token, body: { name: "Ganti" } })).status).toBe(402);
    expect((await call(fx.app, "GET", "/categories", { token: b.token })).status).toBe(200); // data tetap terbaca
    expect((await call(fx.app, "GET", "/items/export", { token: b.token })).status).toBe(200); // dan bisa diekspor
    expect((await call(fx.app, "GET", "/me", { token: b.token })).json.business.billing.level).toBe("locked");

    // diperpanjang: langsung pulih
    await setBilling(b.businessId, { status: "active", trialEndsAt: null, currentPeriodEndsAt: new Date(Date.now() + 30 * DAY), billingInterval: "monthly" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Pulih" } })).status).toBe(201);
  });

  it("ditangguhkan atau dibatalkan: terkunci walau tanggalnya masih jauh; bisnis lain tidak terpengaruh", async () => {
    const b = await makeTrialBusiness("tangguh");
    await setBilling(b.businessId, { status: "suspended", suspendedAt: new Date(), suspendReason: "uji" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "X" } })).status).toBe(402);
    await setBilling(b.businessId, { status: "cancelled" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "X" } })).status).toBe(402);
    const A = (await login(fx.app, fx.a.adminEmail)).token!;
    expect((await call(fx.app, "POST", "/categories", { token: A, body: { name: `Aman ${Date.now()}` } })).status).toBe(201);
  });
});

describe("terkunci: kasir", () => {
  it("penjualan baru ditolak; sinkron offline, tutup shift, dan baca tetap jalan", async () => {
    const b = await makeTrialBusiness("kasir", "pro");
    const item = await call(fx.app, "POST", "/items", { token: b.token, body: { name: "Kopi", variants: [{ name: "R", basePrice: 10000 }] } });
    const dine = ((await call(fx.app, "GET", "/sales-types", { token: b.token })).json.items as { id: string; name: string }[]).find((t) => /dine/i.test(t.name))!.id;
    const pos = await posSession(b);
    expect((await pos("POST", "/shifts/open", { openingCash: 0 })).status).toBe(201);
    const bill = await pos("POST", "/orders", { salesTypeId: dine, lines: [{ kind: "item", variantId: item.json.variants[0].id, quantity: 1 }] });
    expect(bill.status).toBe(201);

    await setBilling(b.businessId, { status: "suspended" });
    const refused = await pos("POST", "/orders", { salesTypeId: dine, lines: [{ kind: "item", variantId: item.json.variants[0].id, quantity: 1 }] });
    expect(refused.status).toBe(402);
    expect(refused.json.code).toBe("payment_required");
    expect((await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 10000 }] })).status).toBe(402);
    expect((await pos("PUT", `/orders/${bill.json.order.id}`, { salesTypeId: dine, lines: [{ kind: "item", variantId: item.json.variants[0].id, quantity: 2 }] })).status).toBe(402);

    expect((await pos("GET", "/catalog")).status).toBe(200);
    expect((await pos("GET", "/orders")).status).toBe(200);
    expect((await pos("POST", "/sync", { ops: [] })).status).toBe(422); // jalur sinkron tidak diblokir (validasi isi saja)
    expect((await pos("POST", "/shifts/close", { actualCash: 0 })).status).toBe(200);
  });
});

describe("batas paket", () => {
  it("outlet dan perangkat melewati batas ditolak 409 dengan rincian; karyawan ikut batas paket", async () => {
    const b = await makeTrialBusiness("batas"); // basic: 1 outlet, 3 perangkat, 10 karyawan
    const outlet = await call(fx.app, "POST", "/outlets", { token: b.token, body: { name: "Cabang 2" } });
    expect(outlet.status).toBe(409);
    expect(outlet.json.extra).toMatchObject({ kind: "outlets", max: 1, used: 1, plan: "basic" });
    expect(outlet.json.message).toMatch(/batas paket/i);

    for (let i = 0; i < 2; i++) expect((await call(fx.app, "POST", "/devices", { token: b.token, body: { outletId: b.outletId, name: `T${i}` } })).status).toBe(201);
    const fourth = await call(fx.app, "POST", "/devices", { token: b.token, body: { outletId: b.outletId, name: "T4" } });
    expect(fourth.status).toBe(409);
    expect(fourth.json.extra).toMatchObject({ kind: "devices", max: 2 });

    // mencabut perangkat membebaskan slot
    const list = await call(fx.app, "GET", "/devices", { token: b.token });
    await call(fx.app, "DELETE", `/devices/${list.json.items[0].id}`, { token: b.token });
    expect((await call(fx.app, "POST", "/devices", { token: b.token, body: { outletId: b.outletId, name: "T5" } })).status).toBe(201);

    // karyawan: 1 admin + 9 = 10; yang ke-11 ditolak
    for (let i = 0; i < 9; i++) {
      const r = await call(fx.app, "POST", "/employees", { token: b.token, body: { name: `K${i}`, email: `k${i}-${Date.now().toString(36)}@billing.test`, roleId: undefined, outletIds: [b.outletId], status: "active" } });
      if (r.status !== 201) {
        // peran wajib: ambil peran kasir bisnis ini
        const roles = (await call(fx.app, "GET", "/roles", { token: b.token })).json.items as { id: string; systemKey: string | null }[];
        const cashier = roles.find((x) => x.systemKey === "cashier")!;
        const retry = await call(fx.app, "POST", "/employees", { token: b.token, body: { name: `K${i}`, email: `k${i}-${Date.now().toString(36)}@billing.test`, roleId: cashier.id, outletIds: [b.outletId], status: "active" } });
        expect(retry.status).toBe(201);
      }
    }
    const roles = (await call(fx.app, "GET", "/roles", { token: b.token })).json.items as { id: string; systemKey: string | null }[];
    const over = await call(fx.app, "POST", "/employees", { token: b.token, body: { name: "Lebih", email: `lebih-${Date.now().toString(36)}@billing.test`, roleId: roles.find((x) => x.systemKey === "cashier")!.id, outletIds: [b.outletId], status: "active" } });
    expect(over.status).toBe(409);
  });

  it("timpaan batas khusus per bisnis mengalahkan paket; paket pro lebih longgar", async () => {
    const b = await makeTrialBusiness("timpa");
    expect((await call(fx.app, "POST", "/outlets", { token: b.token, body: { name: "Cabang 2" } })).status).toBe(409);
    await setBilling(b.businessId, { limits: { maxOutlets: 3 } });
    expect((await call(fx.app, "POST", "/outlets", { token: b.token, body: { name: "Cabang 2" } })).status).toBe(201);
    expect((await call(fx.app, "GET", "/me", { token: b.token })).json.business.billing.limits.maxOutlets).toBe(3);

    const pro = await makeTrialBusiness("pro", "pro");
    for (let i = 0; i < 2; i++) expect((await call(fx.app, "POST", "/outlets", { token: pro.token, body: { name: `C${i}` } })).status).toBe(201);
    expect((await call(fx.app, "POST", "/outlets", { token: pro.token, body: { name: "C5" } })).status).toBe(409);
  });

  it("slot karyawan pilihan pemilik tetap berlaku bila lebih kecil dari batas paket", async () => {
    const b = await makeTrialBusiness("slot", "pro");
    expect((await call(fx.app, "PUT", "/settings/account", { token: b.token, body: { employeeSlots: 1, customerRetentionMonths: null } })).status).toBe(200);
    const roles = (await call(fx.app, "GET", "/roles", { token: b.token })).json.items as { id: string; systemKey: string | null }[];
    const r = await call(fx.app, "POST", "/employees", { token: b.token, body: { name: "Tambahan", email: `t-${Date.now().toString(36)}@billing.test`, roleId: roles.find((x) => x.systemKey === "cashier")!.id, outletIds: [b.outletId], status: "active" } });
    expect(r.status).toBe(409);
    const [admin] = await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.id, b.userId));
    expect(admin).toBeTruthy();
  });
});
