import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, customers, feedback, loyaltyLedger, newId, orders, receiptOutbox, smsOutbox, users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let who: { device: string; token: string };
let dineIn = "";
let variantId = "";

const ERASED = "(data dihapus)";
const pos = (method: string, path: string, body?: unknown) => call(fx.app, method, `/pos${path}`, { token: who.token, headers: { "x-device-token": who.device }, body });
const bo = (method: string, path: string, body?: unknown, token = A) => call(fx.app, method, path, { token, body });
const mk = (body: Record<string, unknown>) => bo("POST", "/customers", body);

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
  dineIn = ((await bo("GET", "/sales-types")).json.items as { id: string; name: string }[]).find((t) => /dine/i.test(t.name))!.id;
  variantId = (await bo("POST", "/items", { name: "Kopi", variants: [{ name: "R", basePrice: 20000 }] })).json.variants[0].id;
  const [admin] = await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, fx.a.adminEmail));
  await bo("POST", `/employees/${admin!.id}/pin`, { pin: "739206" });
  const dev = await bo("POST", "/devices", { outletId: fx.a.outletIds[0], name: "Privasi-1" });
  const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: dev.json.activationCode } });
  const device = act.json.deviceToken as string;
  const s = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: admin!.id, pin: "739206" } });
  who = { device, token: s.json.accessToken };
  expect((await pos("POST", "/shifts/open", { openingCash: 0 })).status).toBe(201);
});
afterAll(async () => {
  await fx.handle.close();
});

describe("persetujuan", () => {
  it("telepon/email hanya boleh disimpan dengan persetujuan; hanya nama tidak butuh", async () => {
    expect((await mk({ name: "Tanpa Setuju", phone: "0811" })).status).toBe(422);
    expect((await mk({ name: "Tanpa Setuju", email: "a@b.co" })).status).toBe(422);
    const nameOnly = await mk({ name: "Hanya Nama" });
    expect(nameOnly.status).toBe(201);
    expect(nameOnly.json.consentAt).toBeNull();
    const ok = await mk({ name: "Setuju", phone: "0812", consent: true });
    expect(ok.status).toBe(201);
    expect(new Date(ok.json.consentAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("mengisi telepon pada pelanggan tanpa persetujuan ditolak sampai persetujuan diberikan; mengosongkan boleh", async () => {
    const c = (await mk({ name: "Belakangan" })).json;
    expect((await bo("PATCH", `/customers/${c.id}`, { phone: "0813" })).status).toBe(422);
    const ok = await bo("PATCH", `/customers/${c.id}`, { phone: "0813", consent: true });
    expect(ok.status).toBe(200);
    expect(ok.json.consentAt).toBeTruthy();
    expect((await bo("PATCH", `/customers/${c.id}`, { phone: null })).status).toBe(200);
  });

  it("kasir: pelanggan baru bertelepon butuh persetujuan", async () => {
    expect((await pos("POST", "/customers", { name: "Dari Kasir", phone: "0814" })).status).toBe(422);
    const ok = await pos("POST", "/customers", { name: "Dari Kasir", phone: "0814", consent: true });
    expect(ok.status).toBe(201);
    const [row] = await fx.handle.db.select().from(customers).where(eq(customers.id, ok.json.customer.id));
    expect(row!.consentAt).not.toBeNull();
  });
});

describe("hak hapus (anonimisasi)", () => {
  it("menghapus nama/kontak dari semua salinan, menjaga transaksi dan angka, dan tercatat tanpa data pribadi", async () => {
    const created = await mk({ name: "Siti Rahma", phone: "0899123", email: "siti@contoh.id", note: "alergi kacang", consent: true, enroll: false });
    const id = created.json.id as string;

    // transaksi dengan pelanggan ini (nama dibekukan di pricing_snapshot)
    const bill = await pos("POST", "/orders", { salesTypeId: dineIn, customerId: id, lines: [{ kind: "item", variantId, quantity: 1 }] });
    expect(bill.status).toBe(201);
    const paid = await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 100000 }] });
    expect(paid.status).toBe(200);
    const orderId = bill.json.order.id as string;
    const before = (await fx.handle.db.select().from(orders).where(eq(orders.id, orderId)))[0]!;
    expect(JSON.stringify(before.pricingSnapshot)).toContain("Siti Rahma");

    // data pribadi di tempat lain
    await fx.handle.db.insert(smsOutbox).values({ id: newId(), businessId: fx.a.businessId, customerId: id, phone: "0899123", kind: "code", body: "Kode Siti 123456" });
    await fx.handle.db.insert(receiptOutbox).values({ id: newId(), businessId: fx.a.businessId, orderId, channel: "email", destination: "siti@contoh.id" });
    await pos("POST", "/feedback", { orderId, customerId: id, rating: "bad", comment: "Siti kecewa dengan layanan" });
    await bo("POST", `/customers/${id}/points`, { points: 5, note: "bonus untuk Siti" });

    const erase = await bo("POST", `/customers/${id}/erase`);
    expect(erase.status).toBe(200);
    expect(erase.json.report).toMatchObject({ orders: 1, smsMessages: 1, receiptMessages: 1, feedback: 1, ledgerNotes: 1 });
    expect(erase.json.report.auditRows).toBeGreaterThanOrEqual(2);

    // pelanggan: disembunyikan dan tanpa data pribadi
    expect((await bo("GET", `/customers/${id}`)).status).toBe(404);
    expect((await bo("GET", "/customers?q=Siti")).json.items.length).toBe(0);
    const [c] = await fx.handle.db.select().from(customers).where(eq(customers.id, id));
    expect(c).toMatchObject({ name: ERASED, phone: null, email: null, note: null, consentAt: null });
    expect(c!.anonymizedAt).not.toBeNull();
    expect(c!.deletedAt).not.toBeNull();

    // salinan lain bersih; angka dan transaksi utuh
    const [after] = await fx.handle.db.select().from(orders).where(eq(orders.id, orderId));
    expect(JSON.stringify(after!.pricingSnapshot)).not.toContain("Siti");
    expect(after).toMatchObject({ status: "paid", total: before.total, customerId: id });
    expect((await fx.handle.db.select().from(smsOutbox).where(eq(smsOutbox.customerId, id)))[0]).toMatchObject({ phone: ERASED, body: ERASED });
    expect((await fx.handle.db.select().from(receiptOutbox).where(eq(receiptOutbox.orderId, orderId)))[0]!.destination).toBe(ERASED);
    const fb = (await fx.handle.db.select().from(feedback).where(eq(feedback.customerId, id)))[0]!;
    expect(fb).toMatchObject({ comment: null, reply: null, rating: "bad" });
    const ledger = await fx.handle.db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, id));
    expect(ledger.every((l) => l.note === null)).toBe(true);

    // jejak audit: entri lama dibersihkan; entri penghapusan tidak memuat data pribadi
    const trail = await fx.handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "customer"), eq(auditLogs.entityId, id)));
    expect(trail.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(trail)).not.toMatch(/Siti|0899123|siti@contoh|alergi/);
    expect(trail.some((t) => (t.changes as any)?.erased === true)).toBe(true);

    // nomor telepon bebas dipakai lagi; hapus kedua kali = tidak ditemukan
    expect((await mk({ name: "Orang Lain", phone: "0899123", consent: true })).status).toBe(201);
    expect((await bo("POST", `/customers/${id}/erase`)).status).toBe(404);
  });

  it("bisnis lain tidak bisa menghapus atau mengunduh data pelanggan ini; peran tanpa hak ditolak", async () => {
    const c = (await mk({ name: "Rahasia", phone: "0877111", consent: true })).json;
    expect((await bo("POST", `/customers/${c.id}/erase`, undefined, B)).status).toBe(404);
    expect((await bo("GET", `/customers/${c.id}/data`, undefined, B)).status).toBe(404);
    const investor = (await login(fx.app, fx.a.investorEmail)).token!;
    expect((await bo("POST", `/customers/${c.id}/erase`, undefined, investor)).status).toBe(403);
    expect((await bo("GET", `/customers/${c.id}/data`, undefined, investor)).status).toBe(403);
    expect((await fx.handle.db.select().from(customers).where(eq(customers.id, c.id)))[0]!.name).toBe("Rahasia");
  });
});

describe("hak akses/portabilitas (unduh data)", () => {
  it("memuat profil, persetujuan, transaksi, poin, dan masukan; tercatat di audit", async () => {
    const c = (await mk({ name: "Dewi Ekspor", phone: "0866222", email: "dewi@contoh.id", consent: true })).json;
    const bill = await pos("POST", "/orders", { salesTypeId: dineIn, customerId: c.id, lines: [{ kind: "item", variantId, quantity: 2 }] });
    await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 100000 }] });
    await pos("POST", "/feedback", { orderId: bill.json.order.id, customerId: c.id, rating: "good", comment: "enak" });
    await bo("POST", `/customers/${c.id}/points`, { points: 7, note: "hadiah ulang tahun" });

    const res = await call(fx.app, "GET", `/customers/${c.id}/data`, { token: A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const data = res.json;
    expect(data.customer).toMatchObject({ name: "Dewi Ekspor", phone: "0866222", email: "dewi@contoh.id" });
    expect(data.customer.consentAt).toBeTruthy();
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({ status: "paid" });
    expect(data.loyaltyLedger.map((l: any) => l.note)).toContain("hadiah ulang tahun");
    expect(data.feedback[0]).toMatchObject({ rating: "good", comment: "enak" });
    expect(data.generatedAt).toBeTruthy();
    const trail = await fx.handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "customer"), eq(auditLogs.entityId, c.id)));
    expect(trail.some((t) => (t.changes as any)?.dataExported === true)).toBe(true);
  });
});

describe("retensi pelanggan tidak aktif", () => {
  it("dry-run mendaftar, terapkan menghapus; pelanggan aktif dan baru tetap utuh; wajib ada batas bulan", async () => {
    const old = (await mk({ name: "Pelanggan Lama", phone: "0855001", consent: true })).json.id as string;
    const withOrder = (await mk({ name: "Masih Belanja", phone: "0855002", consent: true })).json.id as string;
    const fresh = (await mk({ name: "Baru Daftar", phone: "0855003", consent: true })).json.id as string;
    const bill = await pos("POST", "/orders", { salesTypeId: dineIn, customerId: withOrder, lines: [{ kind: "item", variantId, quantity: 1 }] });
    await pos("POST", `/orders/${bill.json.order.id}/pay`, { payments: [{ method: "cash", amount: 100000 }] });

    // "tua": pelanggan lama dan yang punya order dimundurkan updatedAt-nya 2 tahun; order lama dibayar 2 tahun lalu juga untuk 'lama'
    const twoYears = new Date(Date.now() - 2 * 365 * 24 * 3600_000);
    await fx.handle.db.update(customers).set({ updatedAt: twoYears }).where(eq(customers.id, old));
    await fx.handle.db.update(customers).set({ updatedAt: twoYears }).where(eq(customers.id, withOrder));

    // belum ada kebijakan dan tanpa months: ditolak
    expect((await bo("POST", "/customers/purge-inactive", { dryRun: true })).status).toBe(422);
    expect((await bo("GET", "/customers/retention")).json).toMatchObject({ months: null, due: null });

    const dry = await bo("POST", "/customers/purge-inactive", { months: 12 });
    expect(dry.json).toMatchObject({ dryRun: true, months: 12 });
    const ids = dry.json.sample.map((s: any) => s.id);
    expect(ids).toContain(old);
    expect(ids).not.toContain(withOrder); // order barusan = aktivitas terbaru
    expect(ids).not.toContain(fresh);
    expect((await fx.handle.db.select().from(customers).where(eq(customers.id, old)))[0]!.name).toBe("Pelanggan Lama"); // dry-run tidak mengubah

    expect((await bo("PUT", "/settings/account", { employeeSlots: null, customerRetentionMonths: 12 })).status).toBe(200);
    expect((await bo("GET", "/customers/retention")).json.due).toBeGreaterThanOrEqual(1);

    const applied = await bo("POST", "/customers/purge-inactive", { dryRun: false });
    expect(applied.json).toMatchObject({ dryRun: false, months: 12 });
    expect(applied.json.erased).toBeGreaterThanOrEqual(1);
    expect((await fx.handle.db.select().from(customers).where(eq(customers.id, old)))[0]).toMatchObject({ name: ERASED, phone: null });
    expect((await fx.handle.db.select().from(customers).where(eq(customers.id, withOrder)))[0]!.name).toBe("Masih Belanja");
    expect((await fx.handle.db.select().from(customers).where(eq(customers.id, fresh)))[0]!.name).toBe("Baru Daftar");
  });
});

describe("nomor pajak di struk", () => {
  it("disimpan di pengaturan struk dan sampai ke aplikasi kasir; bisa dikosongkan; terbatas bisnis sendiri", async () => {
    const put = await bo("PUT", "/settings/receipt", { taxId: "01.234.567.8-901.000", taxIdLabel: "NPWP" });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ taxId: "01.234.567.8-901.000", taxIdLabel: "NPWP" });
    expect((await pos("GET", "/settings")).json.receipt).toMatchObject({ taxId: "01.234.567.8-901.000", taxIdLabel: "NPWP" });
    expect((await bo("GET", "/settings", undefined, B)).json.receipt.taxId).toBe("");
    expect((await bo("PUT", "/settings/receipt", { taxId: "x".repeat(41) })).status).toBe(422);
    expect((await bo("PUT", "/settings/receipt", {})).json).toMatchObject({ taxId: "", taxIdLabel: "" });
  });

  it("kebijakan retensi tersimpan di pengaturan akun (batas 1-240 bulan)", async () => {
    expect((await bo("PUT", "/settings/account", { employeeSlots: null, customerRetentionMonths: 24 })).json.customerRetentionMonths).toBe(24);
    expect((await bo("PUT", "/settings/account", { employeeSlots: null, customerRetentionMonths: 0 })).status).toBe(422);
    expect((await bo("PUT", "/settings/account", { employeeSlots: null, customerRetentionMonths: 241 })).status).toBe(422);
    expect((await bo("PUT", "/settings/account", { employeeSlots: null, customerRetentionMonths: null })).json.customerRetentionMonths).toBeNull();
  });
});
