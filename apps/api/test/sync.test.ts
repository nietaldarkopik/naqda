import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { counters, orderActivities, orders, payments, users } from "@naqdi/db";
import { priceCartOffline, type CartInput, type OfflineCatalog, type PricingPack } from "@naqdi/domain";
import { MemoryStore, SyncQueue, buildSaleOp, type SaleOp, type SyncResult } from "@naqdi/sync";
import { call, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let cashier: { device: string; token: string; userId: string };
let admin: { device: string; token: string; userId: string };
let shiftId = "";
let adminShiftId = "";

let dineIn = "";
let takeAway = "";
let kopi = "";
let teh = "";
let air = "";
let boba = "";
let gula = "";
let bundleId = "";
let disc20 = "";
let general10 = "";
let kopiItemId = "";
const ADMIN_PIN = "739206";

const userIdOf = async (email: string) => (await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]!.id;

const pairAndLogin = async (outletId: string, email: string, pin: string) => {
  const uid = await userIdOf(email);
  expect((await call(fx.app, "POST", `/employees/${uid}/pin`, { token: A, body: { pin } })).status).toBeLessThan(300);
  const created = await call(fx.app, "POST", "/devices", { token: A, body: { outletId, name: `S-${pin}` } });
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
  const device = act.json.deviceToken as string;
  const res = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: uid, pin } });
  expect(res.status).toBe(200);
  return { device, token: res.json.accessToken as string, userId: uid };
};

const pos = (who: { device: string; token: string }, method: string, path: string, body?: unknown) =>
  call(fx.app, method, `/pos${path}`, { token: who.token, headers: { "x-device-token": who.device }, body });

const sync = async (who: { device: string; token: string }, ops: unknown[]) => {
  const res = await pos(who, "POST", "/sync", { ops });
  expect(res.status).toBe(200);
  return res.json.results as SyncResult[];
};

const loadPack = async (who: { device: string; token: string }) => {
  const catalog = (await pos(who, "GET", "/catalog")).json as OfflineCatalog;
  const pack = (await pos(who, "GET", "/pricing-pack")).json as PricingPack;
  return { catalog, pack };
};

const item = (variantId: string, quantity: number, extra: Record<string, unknown> = {}) => ({ kind: "item" as const, variantId, quantity, modifierOptionIds: [] as string[], ...extra });

let seq = 0;
const uuidv = () => {
  // UUID v4 deterministik cukup untuk tes (kolom id bertipe uuid).
  seq += 1;
  const hex = seq.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
};

/** Menjual offline: harga dihitung oleh kode domain di "perangkat", lalu dibungkus jadi operasi sinkron. */
const makeSale = (cart: CartInput, env: { catalog: OfflineCatalog; pack: PricingPack }, who: { userId: string }, shift: string, payAmount?: number, over: Partial<SaleOp> = {}): SaleOp => {
  const price = priceCartOffline(env.pack, env.catalog, cart, true);
  const total = price.priced.totals.total;
  return {
    ...buildSaleOp({
      clientId: uuidv(),
      clientRef: `OFF-TEST-${seq}`,
      createdAt: new Date(),
      userId: who.userId,
      shiftId: shift,
      salesTypeId: cart.salesTypeId,
      price,
      payments: [{ method: "cash", amount: payAmount ?? total }],
    }),
    ...over,
  };
};

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  const { login } = await import("./helpers");
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  const types = (await call(fx.app, "GET", "/sales-types", { token: A })).json.items as { id: string; name: string }[];
  dineIn = types.find((t) => /dine/i.test(t.name))!.id;
  takeAway = types.find((t) => /take/i.test(t.name))!.id;

  expect((await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } })).status).toBe(201);
  const g = await call(fx.app, "POST", "/gratuities", { token: A, body: { name: "Service", rateBp: 500, allOutlets: true } });
  expect((await call(fx.app, "PATCH", `/sales-types/${dineIn}`, { token: A, body: { gratuityIds: [g.json.id] } })).status).toBe(200);

  const mod = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Topping", minSelect: 0, maxSelect: 2, options: [{ name: "Boba", price: 3000 }, { name: "Jelly", price: 2500 }] } });
  boba = (mod.json.options as { id: string; name: string }[]).find((o) => o.name === "Boba")!.id;
  const gm = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Gula", minSelect: 1, maxSelect: 1, options: [{ name: "Normal", price: 0 }, { name: "Less", price: 0 }] } });
  gula = gm.json.options[0].id;

  const k = await call(fx.app, "POST", "/items", { token: A, body: { name: "Kopi", variants: [{ name: "R", basePrice: 20000, cost: 8000, sku: "KOPI", prices: [{ salesTypeId: takeAway, price: 22000 }] }], modifierSetIds: [mod.json.id] } });
  kopi = k.json.variants[0].id;
  const kopiItem = k.json.id as string;
  kopiItemId = kopiItem;
  const t = await call(fx.app, "POST", "/items", { token: A, body: { name: "Teh", variants: [{ name: "R", basePrice: 10000, sku: "TEH" }], modifierSetIds: [gm.json.id] } });
  teh = t.json.variants[0].id;
  const tehItem = t.json.id as string;
  const a = await call(fx.app, "POST", "/items", { token: A, body: { name: "Air Mineral", trackStock: true, variants: [{ name: "R", basePrice: 5000, cost: 2000, sku: "AIR" }] } });
  air = a.json.variants[0].id;
  const b = await call(fx.app, "POST", "/bundles", { token: A, body: { name: "Paket Hemat", price: 40000, items: [{ variantId: kopi, quantity: 1 }, { variantId: teh, quantity: 1 }], prices: [{ salesTypeId: takeAway, price: 42000 }] } });
  expect(b.status).toBe(201);
  bundleId = b.json.id;

  disc20 = (await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Karyawan 20%", kind: "percent", value: 2000, customizable: true, scope: "item", itemIds: [kopiItem], allOutlets: true } })).json.id;
  general10 = (await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Umum 10%", kind: "percent", value: 1000, allOutlets: true } })).json.id;
  const promo = await call(fx.app, "POST", "/promos", { token: A, body: { name: "Teh 2 gratis diskon", type: "item_discount", requirementScope: "item", requirementItemId: tehItem, requirementQuantity: 2, rewardKind: "percent", rewardValue: 1500 } });
  expect(promo.status).toBe(201);

  cashier = await pairAndLogin(fx.a.outletIds[0]!, fx.a.cashierEmail, "482615");
  admin = await pairAndLogin(fx.a.outletIds[0]!, fx.a.adminEmail, ADMIN_PIN);
  shiftId = (await pos(cashier, "POST", "/shifts/open", { openingCash: 100000 })).json.shift.id;
  adminShiftId = (await pos(admin, "POST", "/shifts/open", { openingCash: 0 })).json.shift.id;
});
afterAll(async () => {
  await fx.handle.close();
});

const receiptCounter = async () => (await fx.handle.db.select({ v: counters.value }).from(counters).where(and(eq(counters.outletId, fx.a.outletIds[0]!), eq(counters.kind, "receipt"))).limit(1))[0]?.v ?? 0;

describe("paritas harga: perangkat offline = server", () => {
  it("total dan rincian baris sama untuk berbagai keranjang", async () => {
    const env = await loadPack(admin);
    const carts: { name: string; cart: CartInput }[] = [
      { name: "take away + modifier", cart: { salesTypeId: takeAway, lines: [item(kopi, 2, { modifierOptionIds: [boba] })] } },
      { name: "dine in: service + pajak atas service", cart: { salesTypeId: dineIn, lines: [item(kopi, 2), item(teh, 1, { modifierOptionIds: [gula] })] } },
      { name: "promo teh (2 unit)", cart: { salesTypeId: dineIn, lines: [item(teh, 3, { modifierOptionIds: [gula] })] } },
      { name: "diskon baris + diskon pesanan", cart: { salesTypeId: dineIn, lines: [item(kopi, 2, { discount: { discountId: disc20 } })], orderDiscount: { discountId: general10 } } },
      { name: "diskon bebas nilai", cart: { salesTypeId: takeAway, lines: [item(kopi, 1, { discount: { discountId: disc20, value: 5000 } })] } },
      { name: "paket", cart: { salesTypeId: takeAway, lines: [{ kind: "bundle", bundleId, quantity: 2 }, item(air, 3)] } },
    ];
    for (const { name, cart } of carts) {
      const server = (await pos(admin, "POST", "/price", cart)).json;
      const local = priceCartOffline(env.pack, env.catalog, cart, true);
      expect(local.priced.totals.total, name).toBe(server.totals.total);
      expect(local.priced.totals, name).toEqual(server.totals);
      expect(
        local.priced.totals.lines.map((l) => ({ gross: l.gross, discount: l.discount, promoDiscount: l.promoDiscount, afterDiscount: l.afterDiscount })),
        name,
      ).toEqual(server.lines.map((l: any) => ({ gross: l.gross, discount: l.discount, promoDiscount: l.promoDiscount, afterDiscount: l.afterDiscount })));
      expect(local.lines.map((l) => l.name), name).toEqual(server.lines.map((l: any) => l.name));
      expect((local.priced.snapshot as any).taxes, name).toEqual(server.snapshot.taxes);
      expect((local.priced.snapshot as any).gratuities, name).toEqual(server.snapshot.gratuities);
    }
  });

  it("aturan keranjang ditegakkan sama: modifier wajib, batas, diskon di luar lingkup", async () => {
    const env = await loadPack(admin);
    const bad: CartInput[] = [
      { salesTypeId: takeAway, lines: [item(teh, 1)] }, // Gula wajib
      { salesTypeId: takeAway, lines: [item(kopi, 1, { modifierOptionIds: [boba, "018f0000-0000-7000-8000-000000000000"] })] },
      { salesTypeId: dineIn, lines: [item(kopi, 1, { discount: { discountId: general10 } })] }, // diskon umum di baris
      { salesTypeId: dineIn, lines: [item(kopi, 1)], orderDiscount: { discountId: disc20 } }, // diskon item di pesanan
    ];
    for (const cart of bad) {
      expect((await pos(admin, "POST", "/price", cart)).status).toBe(422);
      expect(() => priceCartOffline(env.pack, env.catalog, cart, true)).toThrow();
    }
    // Tanpa hak diskon
    expect(() => priceCartOffline(env.pack, env.catalog, { salesTypeId: dineIn, lines: [item(kopi, 1, { discount: { discountId: disc20 } })] }, false)).toThrow();
  });

  it("paket harga hanya memuat data outlet kasir dan butuh sesi kasir", async () => {
    expect((await call(fx.app, "GET", "/pos/pricing-pack", { headers: { "x-device-token": cashier.device } })).status).toBe(401);
    const { pack } = await loadPack(cashier);
    expect(pack.outletId).toBe(fx.a.outletIds[0]);
    expect(pack.taxes.map((x) => x.rateBp)).toEqual([1100]);
    expect(pack.gratuitiesBySalesType[dineIn]!.map((x) => x.rateBp)).toEqual([500]);
    expect(pack.gratuitiesBySalesType[takeAway]).toEqual([]);
  });
});

describe("sinkron penjualan offline", () => {
  it("20 penjualan offline lalu sinkron: tanpa duplikat, nomor struk berurutan, kas shift tercatat", async () => {
    const env = await loadPack(cashier);
    const receiptsBefore = await receiptCounter();
    const store = new MemoryStore();
    const queue = new SyncQueue(store, async (ops) => (await sync(cashier, ops)));
    const sales: SaleOp[] = [];
    let expectedCash = 0;
    for (let i = 0; i < 20; i++) {
      const cart: CartInput = i % 3 === 0 ? { salesTypeId: dineIn, lines: [item(kopi, 1 + (i % 2))] } : { salesTypeId: takeAway, lines: [item(kopi, 1, { modifierOptionIds: i % 2 ? [boba] : [] }), item(teh, 2, { modifierOptionIds: [gula] })] };
      const total = priceCartOffline(env.pack, env.catalog, cart, true).priced.totals.total;
      const op = makeSale(cart, env, cashier, shiftId, total + 2000); // tunai lebih -> kembalian 2000
      op.clientRef = await queue.nextRef();
      sales.push(op);
      expectedCash += total;
      await queue.enqueue(op);
    }
    // Operasi yang sama diantrekan lagi (mis. tombol ditekan dua kali) tidak menggandakan antrean.
    await queue.enqueue(sales[0]!);
    expect((await queue.entries()).length).toBe(20);

    const first = await queue.flush();
    expect(first).toMatchObject({ sent: 20, synced: 20, failed: 0, interrupted: false });
    expect(await queue.pendingCount()).toBe(0);

    // Kirim ulang semuanya (jaringan putus sebelum jawaban sampai): server menjawab duplicate, tidak membuat order baru.
    const replay = await sync(cashier, sales);
    expect(replay.every((r) => r.status === "duplicate")).toBe(true);

    const rows = await fx.handle.db.select().from(orders).where(inArray(orders.id, sales.map((x) => x.clientId)));
    expect(rows.length).toBe(20);
    const numbers = rows.map((r) => r.receiptNumber!).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => receiptsBefore + 1 + i)); // berurutan tanpa celah
    expect(rows.every((r) => r.status === "paid" && r.shiftId === shiftId && r.userId === cashier.userId)).toBe(true);
    // Urutan nomor mengikuti urutan penjualan
    const byClient = new Map(rows.map((r) => [r.id, r.receiptNumber!]));
    expect(sales.map((s) => byClient.get(s.clientId))).toEqual(sales.map((_, i) => receiptsBefore + 1 + i));

    const pays = await fx.handle.db.select().from(payments).where(eq(payments.shiftId, shiftId));
    expect(pays.filter((p) => sales.some((s) => s.clientId === p.orderId)).length).toBe(20);
    const shift = (await pos(cashier, "GET", "/shifts/current")).json.shift;
    expect(shift.cashSales).toBeGreaterThanOrEqual(expectedCash);
    expect((await queue.synced()).length).toBe(20);
  });

  it("antrean tidak kehilangan operasi saat jaringan putus di tengah, lalu lanjut tanpa duplikat", async () => {
    const env = await loadPack(cashier);
    const store = new MemoryStore();
    let online = false;
    const queue = new SyncQueue(store, async (ops) => {
      if (!online) throw new Error("network");
      return sync(cashier, ops);
    }, { batchSize: 3 });
    for (let i = 0; i < 7; i++) await queue.enqueue(makeSale({ salesTypeId: takeAway, lines: [item(teh, 1, { modifierOptionIds: [gula] })] }, env, cashier, shiftId));
    expect(await queue.flush()).toMatchObject({ synced: 0, interrupted: true });
    expect(await queue.pendingCount()).toBe(7);
    online = true;
    expect(await queue.flush()).toMatchObject({ synced: 7, interrupted: false });
    expect(await queue.pendingCount()).toBe(0);
  });

  it("pengiriman bersamaan untuk id yang sama hanya membuat satu order", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    const before = await receiptCounter();
    const results = (await Promise.all([sync(cashier, [op]), sync(cashier, [op]), sync(cashier, [op])])).map((r) => r[0]!);
    expect(results.filter((r) => r.status === "created").length).toBe(1);
    expect(results.filter((r) => r.status === "duplicate").length).toBe(2);
    expect(await receiptCounter()).toBe(before + 1); // tidak ada nomor struk yang hilang
    expect((await fx.handle.db.select().from(orders).where(eq(orders.id, op.clientId))).length).toBe(1);
  });

  it("harga server berubah: total kasir dipakai, selisih ditandai untuk ditinjau", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId); // 22000 + 11% = 24420
    const setKopi = (base: number, take: number) =>
      call(fx.app, "PATCH", `/items/${kopiItemId}`, { token: A, body: { variants: [{ id: kopi, name: "R", basePrice: base, cost: 8000, sku: "KOPI", prices: [{ salesTypeId: takeAway, price: take }] }] } });
    expect((await setKopi(25000, 26000)).status).toBe(200);
    const [res] = await sync(cashier, [op]);
    expect(res).toMatchObject({ status: "created" });
    expect(res!.flags).toContain("price_mismatch");
    const [row] = await fx.handle.db.select().from(orders).where(eq(orders.id, op.clientId));
    expect(row!.total).toBe(op.total); // yang dibayar pelanggan, bukan harga baru
    const acts = await fx.handle.db.select().from(orderActivities).where(eq(orderActivities.orderId, op.clientId));
    expect(acts.map((a) => a.kind).sort()).toEqual(["paid", "sync_review"]);
    expect((acts.find((a) => a.kind === "sync_review")!.detail as any).flags).toContain("price_mismatch");
    expect((await setKopi(20000, 22000)).status).toBe(200);
  });

  it("stok kurang: penjualan tetap dicatat (stok minus) dan ditandai", async () => {
    const env = await loadPack(cashier);
    expect((await call(fx.app, "PATCH", `/outlets/${fx.a.outletIds[0]}`, { token: A, body: { stockMode: "block" } })).status).toBe(200);
    try {
      // Online ditolak karena stok kurang ...
      const bill = await pos(cashier, "POST", "/orders", { salesTypeId: takeAway, lines: [item(air, 2)] });
      const online = await pos(cashier, "POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 20000 }] });
      expect(online.status).toBe(409);
      // ... tetapi penjualan offline yang sudah terjadi tidak boleh ditolak.
      const op = makeSale({ salesTypeId: takeAway, lines: [item(air, 2)] }, env, cashier, shiftId);
      const [res] = await sync(cashier, [op]);
      expect(res).toMatchObject({ status: "created" });
      expect(res!.flags).toContain("stock_negative");
    } finally {
      await call(fx.app, "PATCH", `/outlets/${fx.a.outletIds[0]}`, { token: A, body: { stockMode: "off" } });
    }
  });
});

describe("penolakan dan keamanan sinkron", () => {
  it("total yang tidak cocok dengan hitungan ditolak (perangkat tidak bisa mengarang total)", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    const forged = { ...op, total: 1, payments: [{ method: "cash", amount: 1 }] };
    const [res] = await sync(cashier, [forged]);
    expect(res).toMatchObject({ status: "rejected", code: "inconsistent_quote", retryable: false });
    expect((await fx.handle.db.select().from(orders).where(eq(orders.id, op.clientId))).length).toBe(0);
  });

  it("pembayaran kurang ditolak; non-tunai tidak boleh melebihi tagihan", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    expect((await sync(cashier, [{ ...op, payments: [{ method: "cash", amount: op.total - 1 }] }]))[0]).toMatchObject({ status: "rejected", code: "payment_short" });
    const op2 = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    expect((await sync(cashier, [{ ...op2, payments: [{ method: "qris", amount: op2.total + 5 }] }]))[0]).toMatchObject({ status: "rejected", code: "payment_invalid" });
  });

  it("id katalog milik bisnis lain atau tidak dikenal ditolak", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    const alien = { ...op, lines: [{ ...op.lines[0]!, variantId: "018f0000-0000-7000-8000-000000000000" }] };
    expect((await sync(cashier, [alien]))[0]).toMatchObject({ status: "rejected", code: "invalid_items" });
    const noKind = { ...op, lines: [{ ...op.lines[0]!, variantId: null, bundleId: null }] };
    expect((await sync(cashier, [noKind]))[0]).toMatchObject({ status: "rejected", code: "invalid_items" });
  });

  it("diskon tanpa hak pos.discount ditolak; admin boleh", async () => {
    const env = await loadPack(admin);
    const cart: CartInput = { salesTypeId: dineIn, lines: [item(kopi, 1, { discount: { discountId: disc20 } })] };
    const byCashier = makeSale(cart, env, cashier, shiftId);
    expect((await sync(cashier, [byCashier]))[0]).toMatchObject({ status: "rejected", code: "forbidden_discount" });
    const byAdmin = makeSale(cart, env, admin, adminShiftId);
    expect((await sync(admin, [byAdmin]))[0]).toMatchObject({ status: "created" });
  });

  it("tanpa shift terbuka: ditolak tetapi layak dicoba lagi (penjualan tidak hilang)", async () => {
    const env = await loadPack(cashier);
    expect((await pos(admin, "POST", "/shifts/close", { actualCash: 0 })).status).toBe(200);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, admin, adminShiftId);
    expect((await sync(admin, [op]))[0]).toMatchObject({ status: "rejected", code: "no_shift", retryable: true });
    const open = await pos(admin, "POST", "/shifts/open", { openingCash: 0 });
    expect(open.status).toBe(201);
    // Shift lama sudah tutup; operasi dicatat ke shift baru yang terbuka.
    const [res] = await sync(admin, [op]);
    expect(res).toMatchObject({ status: "created" });
    const [row] = await fx.handle.db.select().from(orders).where(eq(orders.id, op.clientId));
    expect(row!.shiftId).toBe(open.json.shift.id);
  });

  it("kasir yang menyinkronkan boleh berbeda dari penjualnya; penjual tetap tercatat", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    const [res] = await sync(admin, [op]); // admin yang membawa antrean kasir
    expect(res).toMatchObject({ status: "created" });
    const [row] = await fx.handle.db.select().from(orders).where(eq(orders.id, op.clientId));
    expect(row!.userId).toBe(cashier.userId);
    expect(row!.shiftId).toBe(shiftId);
  });

  it("tenant lain tidak bisa memakai id yang sama atau melihat order ini", async () => {
    const envA = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, envA, cashier, shiftId);
    expect((await sync(cashier, [op]))[0]!.status).toBe("created");
    // Perangkat bisnis B menjawab 'conflict' tanpa membocorkan data bisnis A.
    const B = (await (await import("./helpers")).login(fx.app, fx.b.adminEmail)).token!;
    const uid = await userIdOf(fx.b.adminEmail);
    await call(fx.app, "POST", `/employees/${uid}/pin`, { token: B, body: { pin: "159753" } });
    const dev = await call(fx.app, "POST", "/devices", { token: B, body: { outletId: fx.b.outletIds[0], name: "B-1" } });
    const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: dev.json.activationCode } });
    const login = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": act.json.deviceToken }, body: { userId: uid, pin: "159753" } });
    const whoB = { device: act.json.deviceToken as string, token: login.json.accessToken as string };
    const [res] = await sync(whoB, [op]);
    expect(res).toMatchObject({ status: "rejected", code: "conflict" });
  });

  it("waktu perangkat yang salah (jauh di masa depan) dicatat dengan waktu server dan ditandai", async () => {
    const env = await loadPack(cashier);
    const op = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId, undefined, { createdAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const [res] = await sync(cashier, [op]);
    expect(res!.flags).toContain("clock_skew");
    const [row] = await fx.handle.db.select().from(orders).where(eq(orders.id, op.clientId));
    expect(row!.paidAt!.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it("operasi rusak ditolak per operasi tanpa membatalkan yang lain; token Back Office ditolak", async () => {
    const env = await loadPack(cashier);
    const good = makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId);
    const broken = { ...makeSale({ salesTypeId: takeAway, lines: [item(kopi, 1)] }, env, cashier, shiftId), lines: [] };
    const results = await sync(cashier, [broken, good]);
    expect(results.find((r) => r.clientId === broken.clientId)).toMatchObject({ status: "rejected", code: "invalid" });
    expect(results.find((r) => r.clientId === good.clientId)).toMatchObject({ status: "created" });
    expect((await call(fx.app, "POST", "/pos/sync", { token: A, headers: { "x-device-token": cashier.device }, body: { ops: [good] } })).status).toBe(401);
    expect((await call(fx.app, "POST", "/pos/sync", { headers: { "x-device-token": cashier.device }, body: { ops: [good] } })).status).toBe(401);
  });
});
