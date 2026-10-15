import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, businesses, createBusiness, createBusinessWithRoles, outlets, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
});
afterAll(async () => {
  await fx.handle.close();
});

const me = async (token: string) => (await call(fx.app, "GET", "/me", { token })).json.business as { currency: string; currencyExponent: number };

describe("mengganti mata uang bisnis", () => {
  it("bisnis kosong: bisa diganti, exponent diturunkan dari kode ISO, tidak peka huruf besar-kecil", async () => {
    const info = await call(fx.app, "GET", "/settings/currency", { token: A });
    expect(info.json).toMatchObject({ currency: "IDR", exponent: 0, locked: false, reasons: [] });
    expect(info.json.supported.map((c: any) => c.code)).toEqual(expect.arrayContaining(["IDR", "USD", "SGD", "AUD", "CAD", "NZD", "SAR"]));

    const sar = await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "sar" } });
    expect(sar.json).toEqual({ currency: "SAR", exponent: 2 });
    expect(await me(A)).toMatchObject({ currency: "SAR", currencyExponent: 2 });
    expect((await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "KWD" } })).json.exponent).toBe(3);
    expect((await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "IDR" } })).json).toEqual({ currency: "IDR", exponent: 0 });
    expect(await me(B)).toMatchObject({ currency: "IDR" }); // bisnis lain tidak terpengaruh
  });

  it("kode tidak didukung atau salah bentuk ditolak", async () => {
    expect((await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "XXX" } })).status).toBe(422);
    expect((await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "DOLAR" } })).status).toBe(422);
    expect((await call(fx.app, "PUT", "/settings/currency", { token: A, body: {} })).status).toBe(422);
  });

  it("perubahan tercatat di jejak audit", async () => {
    const rows = await fx.handle.db.select().from(auditLogs).where(eq(auditLogs.businessId, fx.a.businessId));
    const changes = rows.filter((r) => r.summary === "currency").map((r) => (r.changes as any).after);
    expect(changes).toEqual(expect.arrayContaining(["SAR", "KWD", "IDR"]));
  });

  it("terkunci begitu ada data bernilai uang; memilih mata uang yang sama tetap aman", async () => {
    expect((await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi", variants: [{ name: "R", basePrice: 18000 }] } })).status).toBe(201);
    const info = await call(fx.app, "GET", "/settings/currency", { token: A });
    expect(info.json.locked).toBe(true);
    expect(info.json.reasons).toContain("items");
    const blocked = await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "USD" } });
    expect(blocked.status).toBe(409);
    expect(blocked.json.extra.reasons).toContain("items");
    expect(await me(A)).toMatchObject({ currency: "IDR", currencyExponent: 0 }); // tidak berubah
    expect((await call(fx.app, "PUT", "/settings/currency", { token: A, body: { currency: "IDR" } })).status).toBe(200);
  });

  it("hanya yang berhak mengelola pengaturan", async () => {
    const cashier = await login(fx.app, fx.a.cashierEmail);
    expect([401, 403]).toContain((await call(fx.app, "PUT", "/settings/currency", { token: cashier.token ?? "x", body: { currency: "USD" } })).status);
  });
});

describe("membuat bisnis baru dengan mata uang pilihan", () => {
  it("createBusinessWithRoles menolak kombinasi mata uang dan desimal yang salah", async () => {
    await expect(createBusinessWithRoles(fx.handle.db, { name: "X", currency: "USD", currencyExponent: 0 })).rejects.toThrow(/2 desimal/);
    await expect(createBusinessWithRoles(fx.handle.db, { name: "X", currency: "IDR", currencyExponent: 2 })).rejects.toThrow(/0 desimal/);
    await expect(createBusinessWithRoles(fx.handle.db, { name: "X", currency: "ZZZ" })).rejects.toThrow(/tidak didukung/);
    const ok = await createBusinessWithRoles(fx.handle.db, { name: "Default" });
    const [row] = await fx.handle.db.select().from(businesses).where(eq(businesses.id, ok.businessId));
    expect(row).toMatchObject({ currency: "IDR", currencyExponent: 0 });
  });

  it("toko riyal Saudi: bisnis, outlet berzona waktu Riyadh, admin bisa login, dan penjualan tepat dalam halala", async () => {
    const email = `owner-${Date.now().toString(36)}@riyadh.test`;
    const made = await createBusiness(fx.handle.db, { name: "Toko Riyadh", currency: "SAR", defaultLocale: "ar", timezone: "Asia/Riyadh", adminEmail: email, adminPassword: "KataSandiKuat1!", bcryptCost: 4 });
    const [outlet] = await fx.handle.db.select().from(outlets).where(eq(outlets.id, made.outletId));
    expect(outlet!.timezone).toBe("Asia/Riyadh");

    const token = (await login(fx.app, email, "KataSandiKuat1!")).token!;
    expect(await me(token)).toMatchObject({ currency: "SAR", currencyExponent: 2 });
    const types = (await call(fx.app, "GET", "/sales-types", { token })).json.items as { id: string; name: string }[];
    const dine = types.find((t) => /dine/i.test(t.name))!.id;
    expect((await call(fx.app, "POST", "/taxes", { token, body: { name: "VAT", rateBp: 1500, allOutlets: true } })).status).toBe(201);
    const item = await call(fx.app, "POST", "/items", { token, body: { name: "Karak", variants: [{ name: "R", basePrice: 1250 }] } }); // 12.50 SAR
    const variantId = item.json.variants[0].id as string;

    await call(fx.app, "POST", `/employees/${made.userId}/pin`, { token, body: { pin: "739206" } });
    const dev = await call(fx.app, "POST", "/devices", { token, body: { outletId: made.outletId, name: "SAR-1" } });
    const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: dev.json.activationCode } });
    const device = act.json.deviceToken as string;
    const session = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: made.userId, pin: "739206" } });
    expect(session.json.business).toMatchObject({ currency: "SAR", currencyExponent: 2, defaultLocale: "ar" });
    const pos = (method: string, path: string, body?: unknown) => call(fx.app, method, `/pos${path}`, { token: session.json.accessToken, headers: { "x-device-token": device }, body });
    expect((await pos("POST", "/shifts/open", { openingCash: 10000 })).status).toBe(201);

    const bill = await pos("POST", "/orders", { salesTypeId: dine, lines: [{ kind: "item", variantId, quantity: 3 }] }); // 37.50 + VAT 15%
    const totals = bill.json.order.totals;
    expect(totals.subtotal).toBe(3750);
    expect(totals.tax).toBe(563); // 562,5 -> 563 (setengah ke atas)
    expect(totals.total).toBe(totals.subtotal + totals.tax + totals.rounding);
    const paid = await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 5000 }] });
    expect(paid.json.order.totals).toMatchObject({ total: totals.total, paid: totals.total, change: 5000 - totals.total });
    expect(paid.json.order.totals.change % 1).toBe(0);

    const [admin] = await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(admin!.id).toBe(made.userId);
  });

  it("menolak email ganda, mata uang atau zona waktu tidak valid, dan kata sandi pendek", async () => {
    const base = { name: "Y", currency: "USD", adminEmail: `y-${Date.now().toString(36)}@usd.test`, adminPassword: "KataSandiKuat1!", bcryptCost: 4 };
    await createBusiness(fx.handle.db, base);
    await expect(createBusiness(fx.handle.db, base)).rejects.toThrow();
    await expect(createBusiness(fx.handle.db, { ...base, adminEmail: "z@usd.test", currency: "ZZZ" })).rejects.toThrow(/tidak didukung/);
    await expect(createBusiness(fx.handle.db, { ...base, adminEmail: "z2@usd.test", timezone: "Mars/Olympus" })).rejects.toThrow(/zona waktu/);
    await expect(createBusiness(fx.handle.db, { ...base, adminEmail: "z3@usd.test", adminPassword: "pendek" })).rejects.toThrow(/8 karakter/);
    await expect(createBusiness(fx.handle.db, { ...base, adminEmail: "bukan-email" })).rejects.toThrow(/email/);
  });

  it("kata sandi acak dikembalikan sekali bila tidak diberikan, dan bisa dipakai login", async () => {
    const email = `acak-${Date.now().toString(36)}@sgd.test`;
    const made = await createBusiness(fx.handle.db, { name: "SGD Shop", currency: "SGD", adminEmail: email, bcryptCost: 4 });
    expect(made.generatedPassword).toBe(true);
    expect(made.password.length).toBeGreaterThanOrEqual(12);
    expect((await login(fx.app, email, made.password)).status).toBe(200);
  });
});
