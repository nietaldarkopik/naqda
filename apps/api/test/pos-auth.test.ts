import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { devices, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let CASHIER_BO: string;
let cashierId: string;
let adminId: string;

beforeAll(async () => {
  fx = await setupFixture();
  const find = async (email: string) => (await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]!.id;
  cashierId = await find(fx.a.cashierEmail);
  adminId = await find(fx.a.adminEmail);
});
afterAll(async () => {
  await fx.handle.close();
});
beforeEach(async () => {
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  CASHIER_BO = (await login(fx.app, fx.a.investorEmail)).token ?? "";
  await fx.handle.db.update(users).set({ pinFailures: 0, pinLockedUntil: null }).where(eq(users.id, cashierId));
});

const setPin = (token: string, id: string, pin: string) => call(fx.app, "POST", `/employees/${id}/pin`, { token, body: { pin } });

const pairDevice = async (name = "Tablet 1") => {
  const created = await call(fx.app, "POST", "/devices", { token: A, body: { outletId: fx.a.outletIds[0], name } });
  expect(created.status).toBe(201);
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
  expect(act.status).toBe(200);
  return { id: created.json.device.id as string, token: act.json.deviceToken as string, activation: act.json };
};

const posLogin = (deviceToken: string, userId: string, pin: string) =>
  call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": deviceToken }, body: { userId, pin } });

describe("PIN karyawan", () => {
  it("menolak format salah dan PIN lemah, menerima PIN kuat", async () => {
    const short = await setPin(A, cashierId, "12");
    expect(short.status).toBe(422);
    expect(short.json.fields.pin).toBeTruthy();
    const weak = await setPin(A, cashierId, "1234");
    expect(weak.status).toBe(422);
    const same = await setPin(A, cashierId, "1111");
    expect(same.status).toBe(422);
    const ok = await setPin(A, cashierId, "482615");
    expect(ok.status).toBeLessThan(300);
    const list = await call(fx.app, "GET", `/employees/${cashierId}`, { token: A });
    expect(JSON.stringify(list.json)).not.toContain("482615");
    expect(JSON.stringify(list.json)).not.toContain("pinHash");
  });

  it("tenant lain tidak bisa mengubah PIN", async () => {
    const res = await setPin(B, cashierId, "482615");
    expect(res.status).toBe(404);
  });
});

describe("aktivasi perangkat", () => {
  it("kode hanya berlaku sekali dan perangkat terdaftar di outlet yang benar", async () => {
    const created = await call(fx.app, "POST", "/devices", { token: A, body: { outletId: fx.a.outletIds[0], name: "Kasir depan" } });
    expect(created.json.activationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const first = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode.toLowerCase() } });
    expect(first.status).toBe(200);
    expect(first.json.outlet.id).toBe(fx.a.outletIds[0]);
    expect(first.json.outlet.settings).toHaveProperty("pricesIncludeTax");
    const second = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
    expect(second.status).toBe(401);
  });

  it("kode kedaluwarsa ditolak", async () => {
    const created = await call(fx.app, "POST", "/devices", { token: A, body: { outletId: fx.a.outletIds[0], name: "Lama" } });
    await fx.handle.db.update(devices).set({ activationExpiresAt: new Date(Date.now() - 1000) }).where(eq(devices.id, created.json.device.id));
    const res = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
    expect(res.status).toBe(401);
  });

  it("hanya peran dengan settings.manage dan hanya outlet milik sendiri", async () => {
    expect((await call(fx.app, "POST", "/devices", { token: CASHIER_BO, body: { outletId: fx.a.outletIds[0], name: "x" } })).status).toBe(403);
    expect((await call(fx.app, "POST", "/devices", { token: B, body: { outletId: fx.a.outletIds[0], name: "x" } })).status).toBe(422);
    const list = await call(fx.app, "GET", "/devices", { token: B });
    expect(list.json.items.every((d: any) => d.outletId !== fx.a.outletIds[0])).toBe(true);
  });

  it("pencabutan langsung memutus perangkat", async () => {
    const dev = await pairDevice("Dicabut");
    await setPin(A, cashierId, "482615");
    expect((await call(fx.app, "GET", "/pos/users", { headers: { "x-device-token": dev.token } })).status).toBe(200);
    expect((await call(fx.app, "DELETE", `/devices/${dev.id}`, { token: A })).status).toBe(204);
    expect((await call(fx.app, "GET", "/pos/users", { headers: { "x-device-token": dev.token } })).status).toBe(401);
  });

  it("kode baru memutus token lama (pasang ulang)", async () => {
    const dev = await pairDevice("Pasang ulang");
    const code = await call(fx.app, "POST", `/devices/${dev.id}/code`, { token: A });
    expect(code.status).toBe(200);
    expect((await call(fx.app, "GET", "/pos/users", { headers: { "x-device-token": dev.token } })).status).toBe(401);
    expect((await call(fx.app, "POST", "/pos/devices/activate", { body: { code: code.json.activationCode } })).status).toBe(200);
  });
});

describe("login PIN kasir", () => {
  it("login sukses, token POS tidak bisa dipakai di Back Office, token BO tidak di POS", async () => {
    const dev = await pairDevice();
    await setPin(A, cashierId, "482615");
    const users_ = await call(fx.app, "GET", "/pos/users", { headers: { "x-device-token": dev.token } });
    expect(users_.json.items.map((u: any) => u.id)).toContain(cashierId);
    expect(users_.json.items.map((u: any) => u.id)).not.toContain(adminId); // admin tanpa PIN

    const res = await posLogin(dev.token, cashierId, "482615");
    expect(res.status).toBe(200);
    expect(res.json.user.privileges.length).toBeGreaterThan(0);
    expect(res.json.outlet.id).toBe(fx.a.outletIds[0]);

    const bo = await call(fx.app, "GET", "/outlets", { token: res.json.accessToken });
    expect(bo.status).toBe(401);
  });

  it("PIN salah, pengguna tak dikenal, dan perangkat tanpa token ditolak", async () => {
    const dev = await pairDevice();
    await setPin(A, cashierId, "482615");
    expect((await posLogin(dev.token, cashierId, "000999")).status).toBe(401);
    expect((await posLogin(dev.token, "018f0000-0000-7000-8000-000000000000", "482615")).status).toBe(401);
    expect((await call(fx.app, "POST", "/pos/auth/pin", { body: { userId: cashierId, pin: "482615" } })).status).toBe(401);
  });

  it("terkunci setelah salah berulang, tetap terkunci walau PIN benar, dan reset setelah lewat", async () => {
    const dev = await pairDevice();
    await setPin(A, cashierId, "482615");
    let locked = 0;
    for (let i = 0; i < 8; i++) {
      const r = await posLogin(dev.token, cashierId, "000999");
      if (r.status === 423) {
        locked++;
        expect(r.json.extra.retryAfterSeconds).toBeGreaterThan(0);
      }
    }
    expect(locked).toBeGreaterThan(0);
    expect((await posLogin(dev.token, cashierId, "482615")).status).toBe(423);
    const list = await call(fx.app, "GET", "/pos/users", { headers: { "x-device-token": dev.token } });
    expect(list.json.items.find((u: any) => u.id === cashierId).locked).toBe(true);

    await fx.handle.db.update(users).set({ pinLockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, cashierId));
    expect((await posLogin(dev.token, cashierId, "482615")).status).toBe(200);
  });

  it("kasir outlet lain tidak bisa login di perangkat ini", async () => {
    const created = await call(fx.app, "POST", "/devices", { token: A, body: { outletId: fx.a.outletIds[1], name: "Outlet 2" } });
    const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
    await setPin(A, cashierId, "482615"); // kasir hanya ditugaskan ke outlet 1
    expect((await posLogin(act.json.deviceToken, cashierId, "482615")).status).toBe(401);
  });

  it("menghapus PIN membuat kasir tak bisa login", async () => {
    const dev = await pairDevice();
    await setPin(A, cashierId, "482615");
    expect((await call(fx.app, "DELETE", `/employees/${cashierId}/pin`, { token: A })).status).toBeLessThan(300);
    expect((await posLogin(dev.token, cashierId, "482615")).status).toBe(401);
  });
});

describe("pengaturan outlet baru", () => {
  it("tersimpan dan divalidasi", async () => {
    const id = fx.a.outletIds[0]!;
    const ok = await call(fx.app, "PATCH", `/outlets/${id}`, { token: A, body: { pricesIncludeGratuity: true, taxOnGratuity: false, roundingStep: 100, roundingMode: "nearest" } });
    expect(ok.status).toBe(200);
    const got = await call(fx.app, "GET", `/outlets/${id}`, { token: A });
    expect(got.json.outlet ?? got.json).toMatchObject({ pricesIncludeGratuity: true, taxOnGratuity: false, roundingStep: 100, roundingMode: "nearest" });
    const bad = await call(fx.app, "PATCH", `/outlets/${id}`, { token: A, body: { roundingMode: "bogus" } });
    expect(bad.status).toBe(422);
  });
});
