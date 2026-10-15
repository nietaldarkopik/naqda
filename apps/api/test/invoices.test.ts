import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businesses, createBusiness, hashPassword, newId, platformAdmins } from "@naqdi/db";
import { trialEndFrom } from "@naqdi/domain";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let OWNER: string;
let SUPPORT: string;
const DAY = 86_400_000;
const PW = "PengelolaKuat123!";
// PNG minimal (8 byte tanda tangan + sedikit isi): cukup untuk lolos pengenalan jenis gambar.
const PNG: Uint8Array<ArrayBuffer> = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const makeAdmin = async (role: "owner" | "support") => {
  const email = `${role}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@platform.test`;
  await fx.handle.db.insert(platformAdmins).values({ id: newId(), email, name: `Pengelola ${role}`, role, status: "active", passwordHash: await hashPassword(PW, 4) });
  return (await call(fx.app, "POST", "/platform/auth/login", { body: { email, password: PW } })).json.accessToken as string;
};
const P = (token: string, method: string, path: string, body?: unknown) => call(fx.app, method, `/platform${path}`, { token, body });

const shop = async (label: string, over: Record<string, unknown> = {}) => {
  const email = `${label}-${Date.now().toString(36)}@faktur.test`;
  const made = await createBusiness(fx.handle.db, { name: `Toko ${label}`, currency: "IDR", adminEmail: email, adminPassword: "KataSandiKuat1!", bcryptCost: 4, plan: "basic", status: "trial", trialEndsAt: trialEndFrom(new Date()), ...over });
  return { ...made, token: (await login(fx.app, email, "KataSandiKuat1!")).token! };
};

const setBiz = (businessId: string, patch: Partial<typeof businesses.$inferInsert>) => fx.handle.db.update(businesses).set(patch).where(eq(businesses.id, businessId));
const getBiz = async (businessId: string) => (await fx.handle.db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1))[0]!;

const sendProof = async (token: string, invoiceId: string, fields: Record<string, string> = {}, file: Uint8Array<ArrayBuffer> | null = PNG) => {
  const form = new FormData();
  const all = { bank: "BCA", sender: "Budi Santoso", transferredOn: new Date().toISOString().slice(0, 10), ...fields };
  for (const [k, v] of Object.entries(all)) form.set(k, v);
  if (file) form.set("file", new File([file], "bukti.png", { type: "image/png" }));
  const res = await fx.app.request(`/api/v1/billing/invoices/${invoiceId}/proof`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const bill = (token: string, method: string, path: string, body?: unknown) => call(fx.app, method, `/billing${path}`, { token, body });

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  OWNER = await makeAdmin("owner");
  SUPPORT = await makeAdmin("support");
});
afterAll(async () => {
  await fx.handle.close();
});

describe("faktur dari sisi pelanggan", () => {
  it("memilih paket membuat faktur terbuka dengan harga daftar; mengganti pilihan membatalkan yang lama", async () => {
    const b = await shop("pilih");
    const first = await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" });
    expect(first.status).toBe(201);
    expect(first.json.invoice).toMatchObject({ plan: "basic", interval: "monthly", amount: 149_000, currency: "IDR", status: "open", provider: "manual_transfer" });
    expect(first.json.invoice.number).toMatch(/^INV-\d{8}-[A-Z0-9]{5}$/);

    const second = await bill(b.token, "POST", "/invoices", { plan: "pro", interval: "yearly" });
    expect(second.json.invoice).toMatchObject({ plan: "pro", amount: 2_990_000, status: "open" });
    const list = await bill(b.token, "GET", "");
    expect(list.json.invoices.find((i: any) => i.id === first.json.invoice.id).status).toBe("void");
    expect(list.json.currentInvoiceId).toBe(second.json.invoice.id);
    expect(list.json.prices).toHaveLength(2);
  });

  it("Enterprise tidak dijual mandiri, paket tak dikenal ditolak, mata uang bukan rupiah tidak punya harga mandiri", async () => {
    const b = await shop("tolak");
    expect((await bill(b.token, "POST", "/invoices", { plan: "unlimited", interval: "monthly" })).status).toBe(422);
    expect((await bill(b.token, "POST", "/invoices", { plan: "gratis", interval: "monthly" })).status).toBe(422);
    const usd = await shop("usd", { currency: "USD" });
    const r = await bill(usd.token, "POST", "/invoices", { plan: "basic", interval: "monthly" });
    expect(r.status).toBe(422);
    expect((await bill(usd.token, "GET", "")).json.prices).toBeNull();
  });

  it("hanya pemilik hak pengaturan; kasir ditolak; faktur bisnis lain tidak terlihat", async () => {
    const b = await shop("hak");
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" })).json.invoice;
    const cashier = (await login(fx.app, fx.a.investorEmail)).token!;
    expect((await bill(cashier, "GET", "")).status).toBe(403);
    const other = (await login(fx.app, fx.a.adminEmail)).token!;
    expect((await bill(other, "GET", "")).json.invoices.find((i: any) => i.id === inv.id)).toBeUndefined();
    expect((await bill(other, "POST", `/invoices/${inv.id}/void`)).status).toBe(404);
    expect((await sendProof(other, inv.id)).status).toBe(404);
  });

  it("bukti transfer: kolom wajib, tanggal tidak boleh di masa depan, hanya gambar; sukses membuat faktur menunggu verifikasi", async () => {
    const b = await shop("bukti");
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" })).json.invoice;
    expect((await sendProof(b.token, inv.id, { bank: "", sender: "" })).status).toBe(422);
    expect((await sendProof(b.token, inv.id, { transferredOn: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10) })).status).toBe(422);
    expect((await sendProof(b.token, inv.id, {}, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).status).toBe(422);

    const ok = await sendProof(b.token, inv.id);
    expect(ok.status).toBe(201);
    expect(ok.json.invoice).toMatchObject({ status: "pending", proof: { bank: "BCA", sender: "Budi Santoso", hasImage: true } });
    // sedang diverifikasi: tidak bisa kirim ulang atau membuat faktur baru, tetapi gambar bisa dilihat pemiliknya
    expect((await sendProof(b.token, inv.id)).status).toBe(409);
    expect((await bill(b.token, "POST", "/invoices", { plan: "pro", interval: "monthly" })).status).toBe(409);
    const img = await fx.app.request(`/api/v1/billing/invoices/${inv.id}/proof-image`, { headers: { authorization: `Bearer ${b.token}` } });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("no-store");
  });
});

describe("verifikasi oleh pengelola", () => {
  it("menyetujui: faktur lunas, paket dan periode berlaku, uji coba berganti aktif; persetujuan ganda ditolak", async () => {
    const b = await shop("setuju");
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "pro", interval: "monthly" })).json.invoice;
    await sendProof(b.token, inv.id);

    const queue = await P(OWNER, "GET", "/invoices?status=pending");
    expect(queue.json.items.some((i: any) => i.id === inv.id && i.business === "Toko setuju")).toBe(true);
    expect((await P(OWNER, "GET", "/overview")).json.pendingInvoices).toBeGreaterThanOrEqual(1);

    const before = Date.now();
    const done = await P(OWNER, "POST", `/invoices/${inv.id}/approve`, {});
    expect(done.status).toBe(200);
    expect(done.json.invoice.status).toBe("paid");
    const after = await getBiz(b.businessId);
    expect(after).toMatchObject({ status: "active", plan: "pro", billingInterval: "monthly" });
    const end = after.currentPeriodEndsAt!.getTime();
    expect(end).toBeGreaterThan(before + 27 * DAY);
    expect(end).toBeLessThan(before + 32 * DAY);
    const me = await call(fx.app, "GET", "/me", { token: b.token });
    expect(me.json.business.billing).toMatchObject({ status: "active", plan: "pro", interval: "monthly" });
    expect(me.json.business.billing.limits.maxOutlets).toBe(3);

    expect((await P(OWNER, "POST", `/invoices/${inv.id}/approve`, {})).status).toBe(409);
    const hist = await P(OWNER, "GET", `/businesses/${b.businessId}`);
    expect(hist.json.history.some((h: any) => h.action === "invoice.approve")).toBe(true);
  });

  it("perpanjangan menambah dari akhir periode berjalan, tanpa menghilangkan hari", async () => {
    const b = await shop("perpanjang");
    const end = new Date(Date.now() + 10 * DAY);
    await setBiz(b.businessId, { status: "active", billingInterval: "yearly", currentPeriodEndsAt: end });
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "yearly" })).json.invoice;
    await sendProof(b.token, inv.id);
    await P(OWNER, "POST", `/invoices/${inv.id}/approve`, {});
    const next = (await getBiz(b.businessId)).currentPeriodEndsAt!;
    const expected = new Date(end);
    expected.setUTCFullYear(expected.getUTCFullYear() + 1);
    expect(next.toISOString()).toBe(expected.toISOString());
  });

  it("menolak: kembali terbuka dengan alasan, pelanggan bisa kirim ulang, lalu disetujui", async () => {
    const b = await shop("tolak-bukti");
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" })).json.invoice;
    await sendProof(b.token, inv.id);
    expect((await P(OWNER, "POST", `/invoices/${inv.id}/reject`, { reason: "x" })).status).toBe(422);
    const rej = await P(OWNER, "POST", `/invoices/${inv.id}/reject`, { reason: "Jumlah transfer tidak sesuai" });
    expect(rej.status).toBe(200);
    expect(rej.json.invoice).toMatchObject({ status: "open", rejectReason: "Jumlah transfer tidak sesuai" });
    expect((await P(OWNER, "POST", `/invoices/${inv.id}/reject`, { reason: "dua kali" })).status).toBe(409);
    expect((await getBiz(b.businessId)).status).toBe("trial"); // menolak tidak mengubah langganan

    expect((await sendProof(b.token, inv.id, { sender: "Budi Santoso" })).status).toBe(201);
    expect((await P(OWNER, "POST", `/invoices/${inv.id}/approve`, {})).status).toBe(200);
  });

  it("peran support hanya melihat; tanpa token ditolak", async () => {
    const b = await shop("peran");
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" })).json.invoice;
    await sendProof(b.token, inv.id);
    expect((await P(SUPPORT, "GET", `/invoices/${inv.id}`)).status).toBe(200);
    expect((await P(SUPPORT, "POST", `/invoices/${inv.id}/approve`, {})).status).toBe(403);
    expect((await P(SUPPORT, "POST", `/invoices/${inv.id}/reject`, { reason: "tidak boleh" })).status).toBe(403);
    expect((await call(fx.app, "POST", `/platform/invoices/${inv.id}/approve`, { body: {} })).status).toBe(401);
    const img = await fx.app.request(`/api/v1/platform/invoices/${inv.id}/proof-image`, { headers: { authorization: `Bearer ${SUPPORT}` } });
    expect(img.status).toBe(200);
  });

  it("bisnis ditangguhkan tetap ditangguhkan setelah bayar, tetapi periodenya bertambah", async () => {
    const b = await shop("tangguh");
    await setBiz(b.businessId, { status: "suspended", suspendedAt: new Date(), suspendReason: "uji" });
    const inv = (await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" })).json.invoice;
    await sendProof(b.token, inv.id);
    const done = await P(OWNER, "POST", `/invoices/${inv.id}/approve`, {});
    expect(done.json.stillSuspended).toBe(true);
    const after = await getBiz(b.businessId);
    expect(after.status).toBe("suspended");
    expect(after.currentPeriodEndsAt).not.toBeNull();
  });
});

describe("terkunci tetap bisa membayar", () => {
  it("uji coba lewat tenggang: Back Office hanya-baca, tetapi faktur dan bukti bisa dikirim; setelah disetujui akses pulih", async () => {
    const b = await shop("kunci");
    await setBiz(b.businessId, { trialEndsAt: new Date(Date.now() - 30 * DAY) });
    expect((await call(fx.app, "POST", "/outlets", { token: b.token, body: { name: "X" } })).status).toBe(402);
    expect((await bill(b.token, "GET", "")).status).toBe(200);
    const inv = await bill(b.token, "POST", "/invoices", { plan: "basic", interval: "monthly" });
    expect(inv.status).toBe(201);
    expect((await sendProof(b.token, inv.json.invoice.id)).status).toBe(201);
    await P(OWNER, "POST", `/invoices/${inv.json.invoice.id}/approve`, {});
    const me = await call(fx.app, "GET", "/me", { token: b.token });
    expect(me.json.business.billing).toMatchObject({ level: "full", status: "active" });
  });
});

describe("perpanjangan otomatis dan faktur khusus", () => {
  it("menjelang akhir periode, faktur perpanjangan terbit sendiri satu kali dengan siklus yang sama", async () => {
    const b = await shop("renew");
    await setBiz(b.businessId, { status: "active", plan: "pro", billingInterval: "monthly", currentPeriodEndsAt: new Date(Date.now() + 3 * DAY) });
    const first = await bill(b.token, "GET", "");
    expect(first.json.invoices).toHaveLength(1);
    expect(first.json.invoices[0]).toMatchObject({ plan: "pro", interval: "monthly", amount: 299_000, status: "open" });
    expect((await bill(b.token, "GET", "")).json.invoices).toHaveLength(1);

    const far = await shop("renew-jauh");
    await setBiz(far.businessId, { status: "active", billingInterval: "monthly", currentPeriodEndsAt: new Date(Date.now() + 20 * DAY) });
    expect((await bill(far.token, "GET", "")).json.invoices).toHaveLength(0);
  });

  it("pengelola membuat faktur khusus (bukan rupiah, Enterprise); faktur ke bisnis tanpa harga wajib menyebut jumlah", async () => {
    const usd = await shop("khusus", { currency: "USD" });
    expect((await P(OWNER, "POST", `/businesses/${usd.businessId}/invoices`, { plan: "pro", interval: "monthly" })).status).toBe(422);
    const r = await P(OWNER, "POST", `/businesses/${usd.businessId}/invoices`, { plan: "pro", interval: "monthly", amount: 2500, note: "kesepakatan" });
    expect(r.status).toBe(201);
    expect(r.json.invoice).toMatchObject({ amount: 2500, currency: "USD", custom: true, status: "open" });
    expect((await P(SUPPORT, "POST", `/businesses/${usd.businessId}/invoices`, { plan: "pro", interval: "monthly", amount: 1 })).status).toBe(403);
    expect((await bill(usd.token, "GET", "")).json.currentInvoiceId).toBe(r.json.invoice.id);
  });
});
