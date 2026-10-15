import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businesses, outlets } from "@naqdi/db";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { clientIp } from "../src/http";
import { call, login, setupFixture, testConfig, type Fixture } from "./helpers";
import { Hono } from "hono";

let fx: Fixture;
beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.handle.close();
});

let n = 0;
const body = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    businessName: `Warung Uji ${Date.now().toString(36)}${n}`,
    ownerName: "Bu Ani",
    email: `ani${n}-${Date.now().toString(36)}@daftar.test`,
    password: "KataSandiKuat1!",
    country: "ID",
    currency: "IDR",
    timezone: "Asia/Jakarta",
    locale: "id",
    acceptTerms: true,
    ...over,
  };
};
const signup = (b: unknown, ip = `10.0.0.${(n % 200) + 1}`) => call(fx.app, "POST", "/public/signup", { body: b, headers: { "x-forwarded-for": ip } });

describe("konfigurasi publik", () => {
  it("memberi tahu apakah pendaftaran terbuka, lama uji coba, versi ketentuan, dan daftar mata uang", async () => {
    const r = await call(fx.app, "GET", "/public/config");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ signupEnabled: true, trialDays: 14 });
    expect(r.json.termsVersion).toBeTruthy();
    expect(r.json.currencies.map((c: any) => c.code)).toEqual(expect.arrayContaining(["IDR", "USD", "SAR"]));
  });
});

describe("pendaftaran mandiri", () => {
  it("membuat bisnis uji coba 14 hari dengan admin yang bisa langsung masuk", async () => {
    const b = body({ currency: "SAR", timezone: "Asia/Riyadh", country: "SA", locale: "ar" });
    const res = await signup(b);
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ ok: true, trialDays: 14 });

    const [biz] = await fx.handle.db.select().from(businesses).where(eq(businesses.name, b.businessName));
    expect(biz).toMatchObject({ status: "trial", plan: "basic", currency: "SAR", currencyExponent: 2, country: "SA", defaultLocale: "ar" });
    expect(biz!.termsAcceptedAt).not.toBeNull();
    expect(biz!.termsVersion).toBeTruthy();
    const days = (biz!.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const [outlet] = await fx.handle.db.select().from(outlets).where(eq(outlets.businessId, biz!.id));
    expect(outlet).toMatchObject({ name: b.businessName, timezone: "Asia/Riyadh" });

    const session = await login(fx.app, b.email, b.password);
    expect(session.status).toBe(200);
    const me = await call(fx.app, "GET", "/me", { token: session.token });
    expect(me.json.business.billing).toMatchObject({ status: "trial", level: "full", plan: "basic", daysLeft: 14 });
    expect(me.json.user).toMatchObject({ name: "Bu Ani" });
    // pemilik baru tidak melihat data bisnis lain
    expect((await call(fx.app, "GET", "/items", { token: session.token })).json.total).toBe(0);
  });

  it("email tidak peka huruf besar-kecil dan tidak bisa dipakai dua kali; tidak ada bisnis yatim", async () => {
    const b = body({ email: `Campur-${Date.now().toString(36)}@Daftar.Test` });
    expect((await signup(b)).status).toBe(201);
    const again = await signup({ ...b, businessName: `Lain ${b.businessName}`, email: b.email.toUpperCase() });
    expect(again.status).toBe(409);
    expect(again.json.fields.email).toMatch(/sudah terdaftar/);
    expect((await fx.handle.db.select().from(businesses).where(eq(businesses.name, `Lain ${b.businessName}`))).length).toBe(0);
  });

  it("pendaftaran serentak dengan email sama: satu berhasil, sisanya 409, tanpa bisnis yatim", async () => {
    const b = body();
    const results = await Promise.all([1, 2, 3].map((i) => signup({ ...b, businessName: `${b.businessName} ${i}` }, `10.9.9.${i}`)));
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(2);
    const made = await fx.handle.db.select().from(businesses).where(eq(businesses.name, `${b.businessName} 1`));
    const all = (await Promise.all([1, 2, 3].map((i) => fx.handle.db.select().from(businesses).where(eq(businesses.name, `${b.businessName} ${i}`))))).flat();
    expect(all.length).toBe(1);
    void made;
  });

  it("memvalidasi isian: kata sandi pendek, mata uang, zona waktu, email, dan wajib setuju ketentuan", async () => {
    expect((await signup(body({ password: "pendek1" }))).status).toBe(422);
    expect((await signup(body({ currency: "XXX" }))).status).toBe(422);
    expect((await signup(body({ timezone: "Mars/Olympus" }))).status).toBe(422);
    expect((await signup(body({ email: "bukan-email" }))).status).toBe(422);
    expect((await signup(body({ businessName: "x" }))).status).toBe(422);
    expect((await signup(body({ country: "Indonesia" }))).status).toBe(422);
    const noTerms = await signup(body({ acceptTerms: false }));
    expect(noTerms.status).toBe(422);
    expect(noTerms.json.fields.acceptTerms).toMatch(/ketentuan/i);
    const missing = body();
    delete (missing as Record<string, unknown>).acceptTerms;
    expect((await signup(missing)).status).toBe(422);
  });

  it("kolom jebakan terisi: tampak berhasil tetapi tidak membuat apa pun", async () => {
    const b = body({ website: "http://spam.example" });
    const res = await signup(b);
    expect(res.status).toBe(201);
    expect((await fx.handle.db.select().from(businesses).where(eq(businesses.name, b.businessName))).length).toBe(0);
    expect((await login(fx.app, b.email, b.password)).status).not.toBe(200);
  });

  it("dibatasi per alamat IP (5 per jam); alamat lain tidak terpengaruh", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 5; i++) expect((await signup(body(), ip)).status).toBe(201);
    const sixth = await signup(body(), ip);
    expect(sixth.status).toBe(429);
    expect((await signup(body(), "203.0.113.78")).status).toBe(201);
  });

  it("dimatikan: 403 dengan pesan, dan tidak membuat apa pun", async () => {
    const off = createApp({ handle: fx.handle, config: parseConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL: testConfig().databaseUrl, JWT_SECRET: testConfig().jwtSecret, BCRYPT_COST: "4", SIGNUP_ENABLED: "false" }) });
    const b = body();
    const res = await call(off, "POST", "/public/signup", { body: b });
    expect(res.status).toBe(403);
    expect(res.json.message).toMatch(/belum dibuka/);
    expect((await call(off, "GET", "/public/config")).json.signupEnabled).toBe(false);
    expect((await fx.handle.db.select().from(businesses).where(eq(businesses.name, b.businessName))).length).toBe(0);
  });
});

describe("alamat klien di belakang proxy", () => {
  const ipOf = async (xff: string | undefined, hops?: number) => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c, hops)));
    const res = await app.request("/", { headers: xff ? { "x-forwarded-for": xff } : {} });
    return res.text();
  };
  it("memakai entri ke-hops dari kanan, bukan entri pertama yang bisa dipalsukan klien", async () => {
    expect(await ipOf("6.6.6.6, 198.51.100.4", 1)).toBe("198.51.100.4"); // 6.6.6.6 dipalsukan penyerang
    expect(await ipOf("6.6.6.6, 198.51.100.4, 127.0.0.1", 2)).toBe("198.51.100.4");
    expect(await ipOf("198.51.100.4", 2)).toBe("198.51.100.4"); // lebih sedikit entri dari hops: entri pertama
    expect(await ipOf("1.1.1.1", 0)).toBe("local"); // hops 0: abaikan header
    expect(await ipOf(undefined, 1)).toBe("local");
  });
});
