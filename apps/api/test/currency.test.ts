import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businesses, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

// Toko luar negeri: USD (2 desimal), pajak 8,25% di luar harga, pembulatan tunai ke 5 sen. Memastikan tidak ada asumsi rupiah.
let fx: Fixture;
let A: string;
let who: { device: string; token: string };
let dineIn = "";
let variantId = "";

const pos = (method: string, path: string, body?: unknown) => call(fx.app, method, `/pos${path}`, { token: who.token, headers: { "x-device-token": who.device }, body });

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  await fx.handle.db.update(businesses).set({ currency: "USD", currencyExponent: 2 }).where(eq(businesses.id, fx.a.businessId));
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  dineIn = ((await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[]).find((t) => /dine/i.test(t.name))!.id;
  expect((await call(fx.app, "POST", "/taxes", { token: A, body: { name: "Sales tax", rateBp: 825, allOutlets: true } })).status).toBe(201);
  expect((await call(fx.app, "PATCH", `/outlets/${fx.a.outletIds[0]}`, { token: A, body: { roundingStep: 5, roundingMode: "nearest" } })).status).toBe(200);
  const item = await call(fx.app, "POST", "/items", { token: A, body: { name: "Latte", variants: [{ name: "R", basePrice: 1237, sku: "LATTE" }] } }); // $12.37
  variantId = item.json.variants[0].id;
  const [admin] = await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, fx.a.adminEmail));
  await call(fx.app, "POST", `/employees/${admin!.id}/pin`, { token: A, body: { pin: "739206" } });
  const dev = await call(fx.app, "POST", "/devices", { token: A, body: { outletId: fx.a.outletIds[0], name: "USD-1" } });
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: dev.json.activationCode } });
  const device = act.json.deviceToken as string;
  const s = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: admin!.id, pin: "739206" } });
  who = { device, token: s.json.accessToken };
  expect(s.json.business).toMatchObject({ currency: "USD", currencyExponent: 2 });
  expect((await pos("POST", "/shifts/open", { openingCash: 10000 })).status).toBe(201);
});
afterAll(async () => {
  await fx.handle.close();
});

describe("toko USD (2 desimal)", () => {
  it("total tepat dalam sen: 2 x $12.37 + pajak 8,25% dibulatkan ke 5 sen", async () => {
    const res = await pos("POST", "/price", { salesTypeId: dineIn, lines: [{ kind: "item", variantId, quantity: 2 }] });
    // subtotal 2474; pajak 8,25% = 204,105 -> 204; total sebelum pembulatan 2678 -> 2680 (kelipatan 5 terdekat)
    expect(res.json.totals).toMatchObject({ subtotal: 2474, tax: 204, rounding: 2, total: 2680 });
  });

  it("bayar tunai $30.00: kembalian tepat $3.20 dalam sen, dan struk bernomor", async () => {
    const bill = await pos("POST", "/orders", { salesTypeId: dineIn, lines: [{ kind: "item", variantId, quantity: 2 }] });
    expect(bill.status).toBe(201);
    const paid = await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 3000 }] });
    expect(paid.status).toBe(200);
    expect(paid.json.order.totals).toMatchObject({ total: 2680, paid: 2680, change: 320 });
    expect(paid.json.order.receiptNumber).toBeGreaterThan(0);
  });

  it("tunai kurang ditolak di batas sen (bukan dibulatkan)", async () => {
    const bill = await pos("POST", "/orders", { salesTypeId: dineIn, lines: [{ kind: "item", variantId, quantity: 2 }] });
    const short = await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 2679 }] });
    expect(short.status).toBe(422);
  });
});
