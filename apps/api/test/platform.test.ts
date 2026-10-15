import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businesses, createBusiness, hashPassword, newId, platformAdmins, platformAudit } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let OWNER: string;
let SUPPORT: string;
const DAY = 86_400_000;
const PW = "PengelolaKuat123!";

const makeAdmin = async (role: "owner" | "support", status: "active" | "disabled" = "active") => {
  const email = `${role}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@platform.test`;
  await fx.handle.db.insert(platformAdmins).values({ id: newId(), email, name: `Pengelola ${role}`, role, status, passwordHash: await hashPassword(PW, 4) });
  return email;
};
const platformLogin = (email: string, password = PW) => call(fx.app, "POST", "/platform/auth/login", { body: { email, password } });
const P = (token: string, method: string, path: string, body?: unknown) => call(fx.app, method, `/platform${path}`, { token, body });

const shop = async (label: string, over: Record<string, unknown> = {}) => {
  const email = `${label}-${Date.now().toString(36)}@toko.test`;
  const made = await createBusiness(fx.handle.db, { name: `Toko ${label} ${Date.now().toString(36)}`, currency: "IDR", adminEmail: email, adminPassword: "KataSandiKuat1!", bcryptCost: 4, ...over });
  return { ...made, token: (await login(fx.app, email, "KataSandiKuat1!")).token! };
};

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  OWNER = (await platformLogin(await makeAdmin("owner"))).json.accessToken;
  SUPPORT = (await platformLogin(await makeAdmin("support"))).json.accessToken;
});
afterAll(async () => {
  await fx.handle.close();
});

describe("masuk dan isolasi token", () => {
  it("login sah menghasilkan token dan data pengelola; sandi salah, email tak dikenal, dan akun nonaktif ditolak", async () => {
    const email = await makeAdmin("owner");
    const ok = await platformLogin(email);
    expect(ok.status).toBe(200);
    expect(ok.json.admin).toMatchObject({ email, role: "owner" });
    expect(ok.json.expiresIn).toBe(8 * 3600);
    expect((await platformLogin(email, "salah-sandi")).status).toBe(401);
    expect((await platformLogin("tidak-ada@platform.test")).status).toBe(401);
    const off = await makeAdmin("owner", "disabled");
    expect((await platformLogin(off)).status).toBe(401);
  });

  it("dibatasi: 5 kegagalan berturut-turut mengunci percobaan berikutnya", async () => {
    const email = await makeAdmin("support");
    for (let i = 0; i < 5; i++) expect((await platformLogin(email, "salah")).status).toBe(401);
    expect((await platformLogin(email, PW)).status).toBe(429); // walau sandi benar
  });

  it("tanpa token ditolak; token toko dan token kasir tidak bisa dipakai sebagai pengelola, dan sebaliknya", async () => {
    expect((await call(fx.app, "GET", "/platform/businesses")).status).toBe(401);
    const A = (await login(fx.app, fx.a.adminEmail)).token!;
    expect((await P(A, "GET", "/businesses")).status).toBe(401); // token toko
    expect((await P("sampah", "GET", "/businesses")).status).toBe(401);
    // token pengelola tidak lolos di API toko
    expect((await call(fx.app, "GET", "/me", { token: OWNER })).status).toBe(401);
    expect((await call(fx.app, "GET", "/items", { token: OWNER })).status).toBe(401);
  });

  it("pengelola yang dinonaktifkan atau diturunkan perannya langsung berlaku walau token masih hidup", async () => {
    const email = await makeAdmin("owner");
    const token = (await platformLogin(email)).json.accessToken as string;
    expect((await P(token, "GET", "/me")).json.admin.role).toBe("owner");
    await fx.handle.db.update(platformAdmins).set({ role: "support" }).where(eq(platformAdmins.email, email));
    const b = await shop("turun");
    expect((await P(token, "PATCH", `/businesses/${b.businessId}`, { status: "cancelled" })).status).toBe(403);
    await fx.handle.db.update(platformAdmins).set({ status: "disabled" }).where(eq(platformAdmins.email, email));
    expect((await P(token, "GET", "/me")).status).toBe(401);
  });
});

describe("daftar dan detail bisnis", () => {
  it("memuat pemilik, pemakaian, batas, dan status akses; pencarian lewat nama dan email pemilik", async () => {
    const b = await shop("cari", { plan: "basic", status: "trial", trialEndsAt: new Date(Date.now() + 5 * DAY) });
    // pemakaian: satu perangkat kasir
    await call(fx.app, "POST", "/devices", { token: b.token, body: { outletId: b.outletId, name: "T1" } });

    const byName = await P(SUPPORT, "GET", `/businesses?q=${encodeURIComponent("Toko cari")}`);
    const row = byName.json.items.find((x: any) => x.id === b.businessId);
    expect(row).toMatchObject({ plan: "basic", status: "trial", currency: "IDR" });
    expect(row.owner.email).toBe(b.email);
    expect(row.usage).toEqual({ outlets: 1, devices: 1, employees: 1 });
    expect(row.limits).toMatchObject({ maxOutlets: 1, maxDevices: 3, maxEmployees: 10 });
    expect(row.access).toMatchObject({ level: "full", reason: "trial", daysLeft: 5 });
    expect(row.orders30d).toBe(0);
    expect(row.lastOrderAt).toBeNull();

    const byEmail = await P(SUPPORT, "GET", `/businesses?q=${encodeURIComponent(b.email)}`);
    expect(byEmail.json.items.map((x: any) => x.id)).toContain(b.businessId);
  });

  it("filter status dan akan berakhir, paginasi, dan total", async () => {
    const soon = await shop("segera", { status: "trial", trialEndsAt: new Date(Date.now() + 2 * DAY), plan: "basic" });
    const later = await shop("lama", { status: "trial", trialEndsAt: new Date(Date.now() + 10 * DAY), plan: "basic" });
    const expiring = await P(SUPPORT, "GET", "/businesses?expiringDays=3");
    const ids = expiring.json.items.map((x: any) => x.id);
    expect(ids).toContain(soon.businessId);
    expect(ids).not.toContain(later.businessId);
    const trials = await P(SUPPORT, "GET", "/businesses?status=trial&pageSize=2&page=1");
    expect(trials.json.items.length).toBeLessThanOrEqual(2);
    expect(trials.json.total).toBeGreaterThanOrEqual(2);
    expect(trials.json.items.every((x: any) => x.status === "trial")).toBe(true);
    expect((await P(SUPPORT, "GET", "/businesses?status=bukan")).status).toBe(422);
  });

  it("detail memuat riwayat tindakan; bisnis tak dikenal 404", async () => {
    const b = await shop("rinci");
    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { plan: "pro", note: "naik paket" });
    const d = await P(SUPPORT, "GET", `/businesses/${b.businessId}`);
    expect(d.status).toBe(200);
    expect(d.json.business.plan).toBe("pro");
    expect(d.json.history[0]).toMatchObject({ action: "business.update", admin: "Pengelola owner" });
    expect(d.json.history[0].detail.note).toBe("naik paket");
    expect((await P(SUPPORT, "GET", `/businesses/${newId()}`)).status).toBe(404);
  });
});

describe("mengubah bisnis", () => {
  it("peran support hanya melihat; owner boleh", async () => {
    const b = await shop("peran");
    expect((await P(SUPPORT, "PATCH", `/businesses/${b.businessId}`, { plan: "pro" })).status).toBe(403);
    expect((await P(SUPPORT, "POST", "/businesses", { name: "X", currency: "IDR", timezone: "Asia/Jakarta", adminEmail: "x@toko.test" })).status).toBe(403);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { plan: "pro" })).status).toBe(200);
  });

  it("tangguhkan butuh alasan; langsung mengunci toko; aktifkan kembali langsung membuka", async () => {
    const b = await shop("tangguh", { plan: "pro", status: "active" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Awal" } })).status).toBe(201);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { status: "suspended" })).status).toBe(422); // tanpa alasan
    const sus = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { status: "suspended", suspendReason: "tunggakan 60 hari" });
    expect(sus.status).toBe(200);
    expect(sus.json.business).toMatchObject({ status: "suspended", suspendReason: "tunggakan 60 hari" });
    expect(sus.json.effective).toMatchObject({ level: "locked", reason: "suspended" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Ditolak" } })).status).toBe(402);

    const back = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { status: "active" });
    expect(back.json.business).toMatchObject({ status: "active", suspendedAt: null, suspendReason: null });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Pulih" } })).status).toBe(201);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { suspendReason: "tanpa status" })).status).toBe(422);
  });

  it("memperpanjang uji coba menyalakan kembali toko yang terkunci; tidak boleh untuk pelanggan aktif atau yang ditangguhkan", async () => {
    const b = await shop("perpanjang", { status: "trial", trialEndsAt: new Date(Date.now() - 30 * DAY), plan: "basic" });
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Kunci" } })).status).toBe(402);
    const ext = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { extendTrialDays: 14, note: "minta waktu lagi" });
    expect(ext.status).toBe(200);
    expect(ext.json.business.status).toBe("trial");
    expect(ext.json.effective).toMatchObject({ level: "full", daysLeft: 14 }); // dihitung dari sekarang, bukan dari tanggal lama
    expect((await call(fx.app, "POST", "/categories", { token: b.token, body: { name: "Buka" } })).status).toBe(201);
    // masih berlaku: ditambahkan di atas sisa yang ada
    const more = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { extendTrialDays: 7 });
    expect(more.json.effective.daysLeft).toBe(21);

    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { status: "active" });
    const refused = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { extendTrialDays: 7 });
    expect(refused.status).toBe(422);
    expect(refused.json.fields.extendTrialDays).toMatch(/uji coba/i);
    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { status: "suspended", suspendReason: "uji" });
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { extendTrialDays: 7 })).status).toBe(422);
  });

  it("ganti paket dan timpa batas berlaku seketika; null menghapus timpaan; angka tidak masuk akal ditolak", async () => {
    const b = await shop("batas", { plan: "basic", status: "trial", trialEndsAt: new Date(Date.now() + 10 * DAY) });
    expect((await call(fx.app, "POST", "/outlets", { token: b.token, body: { name: "Cabang" } })).status).toBe(409);
    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { limits: { maxOutlets: 2 } });
    expect((await call(fx.app, "POST", "/outlets", { token: b.token, body: { name: "Cabang" } })).status).toBe(201);
    const cleared = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { limits: null });
    expect(cleared.json.business.limitsOverride).toBeNull();
    expect(cleared.json.business.limits.maxOutlets).toBe(1);
    expect(cleared.json.usage.outlets).toBe(2); // pemakaian sudah di atas batas: tidak ada yang dihapus
    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { plan: "pro" });
    expect((await call(fx.app, "GET", "/me", { token: b.token })).json.business.billing.limits.maxOutlets).toBe(5);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { plan: "gratis-selamanya" })).status).toBe(422);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { limits: { maxOutlets: 0 } })).status).toBe(422);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, {})).status).toBe(422);
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { note: "hanya catatan" })).status).toBe(422);
  });

  it("langganan: periode dan siklus tagihan tersimpan; periode lewat masuk tenggang lalu terkunci", async () => {
    const b = await shop("langganan", { plan: "pro", status: "active" });
    const end = new Date(Date.now() + 30 * DAY).toISOString();
    const paid = await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { billingInterval: "yearly", currentPeriodEndsAt: end });
    expect(paid.json.business).toMatchObject({ billingInterval: "yearly", currentPeriodEndsAt: end });
    expect(paid.json.effective.daysLeft).toBe(30);
    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { currentPeriodEndsAt: new Date(Date.now() - 3 * DAY).toISOString() });
    expect((await call(fx.app, "GET", "/me", { token: b.token })).json.business.billing).toMatchObject({ level: "grace", reason: "period_expired" });
    await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { currentPeriodEndsAt: new Date(Date.now() - 20 * DAY).toISOString() });
    expect((await call(fx.app, "GET", "/me", { token: b.token })).json.business.billing.level).toBe("locked");
    expect((await P(OWNER, "PATCH", `/businesses/${b.businessId}`, { billingInterval: "mingguan" })).status).toBe(422);
  });
});

describe("membuat bisnis dari panel", () => {
  it("uji coba atau aktif, kata sandi acak ditampilkan sekali, admin bisa masuk, tercatat di audit", async () => {
    const email = `buat-${Date.now().toString(36)}@toko.test`;
    const res = await P(OWNER, "POST", "/businesses", { name: `Toko Panel ${Date.now().toString(36)}`, currency: "SAR", timezone: "Asia/Riyadh", locale: "ar", country: "SA", plan: "pro", mode: "trial", trialDays: 30, adminEmail: email });
    expect(res.status).toBe(201);
    expect(res.json.business).toMatchObject({ status: "trial", plan: "pro", currency: "SAR", country: "SA" });
    expect(res.json.business.access.daysLeft).toBe(30);
    const password = res.json.admin.password as string;
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect((await login(fx.app, email, password)).status).toBe(200);

    const active = await P(OWNER, "POST", "/businesses", { name: `Toko Manual ${Date.now().toString(36)}`, currency: "USD", timezone: "America/New_York", plan: "unlimited", mode: "active", adminEmail: `m-${email}`, adminPassword: "KataSandiPanel1!" });
    expect(active.json.business).toMatchObject({ status: "active", plan: "unlimited", trialEndsAt: null });
    expect(active.json.admin.password).toBeUndefined(); // sandi yang diberikan sendiri tidak diulang

    const trail = await fx.handle.db.select().from(platformAudit).where(eq(platformAudit.businessId, res.json.business.id));
    expect(trail.map((t) => t.action)).toContain("business.create");
  });

  it("email ganda 409 tanpa bisnis yatim; masukan tidak sah 422", async () => {
    const email = `ganda-${Date.now().toString(36)}@toko.test`;
    const base = { currency: "IDR", timezone: "Asia/Jakarta", adminEmail: email };
    expect((await P(OWNER, "POST", "/businesses", { ...base, name: "Pertama Panel" })).status).toBe(201);
    const dup = await P(OWNER, "POST", "/businesses", { ...base, name: "Kedua Panel Yatim" });
    expect(dup.status).toBe(409);
    expect((await fx.handle.db.select().from(businesses).where(eq(businesses.name, "Kedua Panel Yatim"))).length).toBe(0);
    expect((await P(OWNER, "POST", "/businesses", { ...base, name: "Z", adminEmail: "x@toko.test" })).status).toBe(422);
    expect((await P(OWNER, "POST", "/businesses", { ...base, name: "Mata Uang Salah", currency: "XXX", adminEmail: "y@toko.test" })).status).toBe(422);
  });
});

describe("ringkasan dan jejak audit", () => {
  it("ringkasan menghitung status, paket, akses, pendaftaran terbaru, dan uji coba yang segera habis", async () => {
    const b = await shop("ringkas", { status: "trial", trialEndsAt: new Date(Date.now() + 2 * DAY), plan: "basic", country: "ID" });
    const o = await P(SUPPORT, "GET", "/overview");
    expect(o.status).toBe(200);
    expect(o.json.total).toBeGreaterThan(0);
    expect(o.json.byStatus.trial).toBeGreaterThanOrEqual(1);
    expect(o.json.access.full + o.json.access.grace + o.json.access.locked).toBe(o.json.total);
    expect(o.json.signups.last7d).toBeGreaterThanOrEqual(1);
    expect(o.json.trialsExpiringSoon.map((t: any) => t.id)).toContain(b.businessId);
  });

  it("pendaftaran mandiri tercatat dengan pelaku sistem; seluruh tindakan terlihat di audit dengan nama pengelola", async () => {
    const email = `mandiri-${Date.now().toString(36)}@toko.test`;
    const res = await call(fx.app, "POST", "/public/signup", { body: { businessName: `Mandiri ${Date.now().toString(36)}`, ownerName: "Bu Mandiri", email, password: "KataSandiKuat1!", country: "ID", currency: "IDR", timezone: "Asia/Jakarta", locale: "id", acceptTerms: true }, headers: { "x-forwarded-for": "198.51.100.200" } });
    expect(res.status).toBe(201);
    const audit = await P(SUPPORT, "GET", "/audit?pageSize=100");
    const signup = audit.json.items.find((a: any) => a.action === "signup" && a.detail?.currency === "IDR");
    expect(signup).toBeTruthy();
    expect(signup.admin).toBeNull();
    expect(audit.json.items.some((a: any) => a.action === "business.update" && a.admin === "Pengelola owner")).toBe(true);
    const mine = await P(SUPPORT, "GET", `/audit?businessId=${signup.businessId}`);
    expect(mine.json.items.every((a: any) => a.businessId === signup.businessId)).toBe(true);
  });
});
