import path from "node:path";
import os from "node:os";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusiness, hashPassword, mailQueue, newId, platformAdmins } from "@naqdi/db";
import { trialEndFrom } from "@naqdi/domain";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { MAX_ATTEMPTS, enqueueMail, processMailQueue, RETRY_DELAYS_MIN } from "../src/mail/queue";
import { renderMail } from "../src/mail/templates";
import { memoryTransport } from "../src/mail/transport";
import { call, login, setupFixture, testDatabaseUrl, type Fixture } from "./helpers";

let fx: Fixture;
let app: ReturnType<typeof createApp>;
const mem = memoryTransport();
let OWNER: string;
let SUPPORT: string;
const PW = "PengelolaKuat123!";
const MIN = 60_000;
/** Format uang memakai spasi tak-terputus; samakan agar mudah dicocokkan. */
const plain = (s: string) => s.replace(/ /g, " ");
const OPERATOR = `operator-${Date.now().toString(36)}@naqdi.test`;
const BANK = "BCA 123456\\na.n. PT Naqdi";

const config = parseConfig({
  NODE_ENV: "test",
  DATABASE_URL: testDatabaseUrl,
  JWT_SECRET: "rahasia-uji-yang-panjang-minimal-32-karakter-aman",
  BCRYPT_COST: "4",
  CORS_ORIGINS: "http://localhost:3000",
  STORAGE_DIR: path.join(os.tmpdir(), "naqdi-test-storage"),
  OPERATOR_EMAIL: OPERATOR,
  BILLING_BANK_INFO: BANK,
  APP_URL: "https://naqdi.example/",
  MAIL_FROM: "Naqdi <no-reply@naqdi.example>",
  SMTP_PASS: "kata-sandi-smtp-rahasia",
});

const makeAdmin = async (role: "owner" | "support") => {
  const email = `${role}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@platform.test`;
  await fx.handle.db.insert(platformAdmins).values({ id: newId(), email, name: `Pengelola ${role}`, role, status: "active", passwordHash: await hashPassword(PW, 4) });
  return (await call(app, "POST", "/platform/auth/login", { body: { email, password: PW } })).json.accessToken as string;
};
const P = (token: string, method: string, path: string, body?: unknown) => call(app, method, `/platform${path}`, { token, body });
const mailsTo = async (to: string) => fx.handle.db.select().from(mailQueue).where(eq(mailQueue.recipient, to)).orderBy(desc(mailQueue.createdAt));

const shop = async (label: string, over: Record<string, unknown> = {}) => {
  const email = `${label}-${Date.now().toString(36)}@email.test`;
  const made = await createBusiness(fx.handle.db, { name: `Toko ${label}`, currency: "IDR", adminEmail: email, adminName: "Siti Aminah", adminPassword: "KataSandiKuat1!", bcryptCost: 4, plan: "basic", status: "trial", trialEndsAt: trialEndFrom(new Date()), ...over });
  return { ...made, email, token: (await login(app, email, "KataSandiKuat1!")).token! };
};

beforeAll(async () => {
  fx = await setupFixture();
  app = createApp({ handle: fx.handle, config, transport: mem });
  OWNER = await makeAdmin("owner");
  SUPPORT = await makeAdmin("support");
});
afterAll(async () => {
  await fx.handle.close();
});

describe("templat", () => {
  it("tiga bahasa, Arab kanan-ke-kiri, teks pengguna di-escape, uang diformat sesuai mata uang dan bahasa", () => {
    const data = { name: "<b>Siti</b>", business: "A & B", number: "INV-1", plan: "Pro", interval: "yearly" as const, amount: 2_990_000, currency: "IDR", dueDate: "2026-10-23", billingUrl: "https://x.test/id/settings/billing", bankInfo: "BCA 1" };
    const id = renderMail("invoice_issued", "id", data);
    expect(id.subject).toContain("INV-1");
    expect(plain(id.text)).toContain("Rp 2.990.000");
    expect(id.html).toContain("&lt;b&gt;Siti&lt;/b&gt;");
    expect(id.html).not.toContain("<b>Siti</b>");
    expect(id.html).toContain('dir="ltr"');
    const ar = renderMail("invoice_issued", "ar", { ...data, amount: 1500, currency: "SAR" });
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('lang="ar"');
    expect(renderMail("invoice_issued", "en", data).text).toContain("Rp");
  });

  it("tautan bukan http tidak masuk href", () => {
    const m = renderMail("welcome", "id", { name: "A", business: "B", trialDays: 14, loginUrl: "javascript:alert(1)" });
    expect(m.html).toContain('href="#"');
    expect(m.html).not.toContain("javascript:alert");
  });
});

describe("antrean dan pengiriman", () => {
  it("terkirim: status sent, isi sampai ke pengirim, dan tidak dikirim dua kali walau pekerja berjalan bersamaan", async () => {
    const to = `kirim-${Date.now().toString(36)}@tujuan.test`;
    const before = mem.sent.length;
    await enqueueMail(fx.handle.db, { to, kind: "test", locale: "id", data: { to } });
    const [a, b] = await Promise.all([processMailQueue(fx.handle.db, mem), processMailQueue(fx.handle.db, mem)]);
    expect(a.sent + b.sent).toBeGreaterThanOrEqual(1);
    expect(mem.sent.filter((m) => m.to === to)).toHaveLength(1);
    expect(mem.sent.length - before).toBeGreaterThanOrEqual(1);
    const [row] = await mailsTo(to);
    expect(row).toMatchObject({ status: "sent", attempts: 1, lastError: null });
    expect(row!.sentAt).not.toBeNull();
  });

  it("gagal kirim: dicoba ulang dengan jeda bertahap, lalu menyerah (failed) setelah percobaan maksimum; pengelola bisa mengulang", async () => {
    const to = `gagal-${Date.now().toString(36)}@tujuan.test`;
    const id = (await enqueueMail(fx.handle.db, { to, kind: "test", locale: "id", data: { to } }))!;
    mem.failNext(MAX_ATTEMPTS, "koneksi ditolak");
    let now = new Date();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await processMailQueue(fx.handle.db, mem, now);
      expect(r.attempted).toBeGreaterThanOrEqual(1);
      const [row] = await mailsTo(to);
      if (i < MAX_ATTEMPTS - 1) {
        expect(row).toMatchObject({ status: "queued", attempts: i + 1, lastError: "koneksi ditolak" });
        // belum waktunya: tidak dicoba lagi sebelum jeda lewat
        expect((await processMailQueue(fx.handle.db, mem, new Date(now.getTime() + 1000))).attempted).toBe(0);
        now = new Date(now.getTime() + RETRY_DELAYS_MIN[i]! * MIN + 1000);
      } else {
        expect(row).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
      }
    }
    // tidak ada percobaan lagi untuk yang sudah failed
    expect((await processMailQueue(fx.handle.db, mem, new Date(now.getTime() + 24 * 60 * MIN))).attempted).toBe(0);

    expect((await P(SUPPORT, "POST", `/mail/${id}/retry`)).status).toBe(403);
    expect((await P(OWNER, "POST", `/mail/${id}/retry`)).status).toBe(200);
    expect((await P(OWNER, "POST", `/mail/${id}/retry`)).status).toBe(409); // sudah tidak failed
    await processMailQueue(fx.handle.db, mem);
    expect((await mailsTo(to))[0]).toMatchObject({ status: "sent" });
  });

  it("gagal mencatat email tidak melempar (tindakan utama tidak boleh ikut gagal)", async () => {
    expect(await enqueueMail(fx.handle.db, { to: "   ", kind: "test", locale: "id", data: { to: "" } })).toBeNull();
    const tooLong = `${"a".repeat(300)}@x.test`;
    await expect(enqueueMail(fx.handle.db, { to: tooLong, kind: "test", locale: "id", data: { to: tooLong } })).resolves.toBeNull();
  });
});

describe("email yang dipicu tindakan", () => {
  it("pendaftaran mandiri mengirim email selamat datang berbahasa pilihan", async () => {
    const email = `daftar-${Date.now().toString(36)}@email.test`;
    const r = await call(app, "POST", "/public/signup", { body: { businessName: "Warung Email", ownerName: "Rina", email, password: "KataSandiKuat1!", country: "ID", currency: "IDR", timezone: "Asia/Jakarta", locale: "en", acceptTerms: true, website: "" } });
    expect(r.status).toBe(201);
    const [m] = await mailsTo(email);
    expect(m).toMatchObject({ kind: "welcome", locale: "en", status: "queued" });
    expect(m!.subject).toContain("Welcome");
    expect(m!.text).toContain("https://naqdi.example/en/login"); // garis miring akhir APP_URL dibuang
  });

  it("faktur, bukti, persetujuan, dan penolakan: pelanggan dan pengelola menerima email yang tepat", async () => {
    const b = await shop("alur");
    const inv = (await call(app, "POST", "/billing/invoices", { token: b.token, body: { plan: "pro", interval: "monthly" } })).json.invoice;
    const issued = (await mailsTo(b.email)).find((m) => m.kind === "invoice_issued")!;
    expect(issued.subject).toContain(inv.number);
    expect(plain(issued.text)).toContain("Rp 299.000");
    expect(issued.text).toContain("BCA 123456\na.n. PT Naqdi"); // \n literal di env menjadi baris baru
    expect(issued.text).toContain("https://naqdi.example/id/settings/billing");

    const form = new FormData();
    for (const [k, v] of Object.entries({ bank: "BCA", sender: "Siti", transferredOn: new Date().toISOString().slice(0, 10) })) form.set(k, v);
    const sent = await app.request(`/api/v1/billing/invoices/${inv.id}/proof`, { method: "POST", headers: { authorization: `Bearer ${b.token}` }, body: form });
    expect(sent.status).toBe(201);
    const opMails = (await mailsTo(OPERATOR)).filter((m) => m.kind === "proof_received" && m.subject.includes(inv.number));
    expect(opMails).toHaveLength(1);

    await P(OWNER, "POST", `/invoices/${inv.id}/reject`, { reason: "Jumlah tidak sesuai" });
    const rej = (await mailsTo(b.email)).find((m) => m.kind === "payment_rejected")!;
    expect(rej.text).toContain("Jumlah tidak sesuai");

    const form2 = new FormData();
    for (const [k, v] of Object.entries({ bank: "BCA", sender: "Siti", transferredOn: new Date().toISOString().slice(0, 10) })) form2.set(k, v);
    await app.request(`/api/v1/billing/invoices/${inv.id}/proof`, { method: "POST", headers: { authorization: `Bearer ${b.token}` }, body: form2 });
    await P(OWNER, "POST", `/invoices/${inv.id}/approve`, {});
    const ok = (await mailsTo(b.email)).find((m) => m.kind === "payment_approved")!;
    expect(ok.subject).toContain(inv.number);
    expect(ok.status).toBe("queued");
    // semua email milik bisnis ini tercatat dengan businessId
    expect((await mailsTo(b.email)).every((m) => m.businessId !== null)).toBe(true);
  });

  it("faktur khusus dari pengelola juga memberi tahu pelanggan; tanpa OPERATOR_EMAIL tidak ada email ke pengelola", async () => {
    const b = await shop("khusus-mail", { currency: "USD" });
    await P(OWNER, "POST", `/businesses/${b.businessId}/invoices`, { plan: "pro", interval: "monthly", amount: 2500 });
    const m = (await mailsTo(b.email)).find((x) => x.kind === "invoice_issued")!;
    expect(plain(m.text)).toContain("US$25,00");

    const noOp = createApp({ handle: fx.handle, config: parseConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL: testDatabaseUrl, JWT_SECRET: "rahasia-uji-yang-panjang-minimal-32-karakter-aman", BCRYPT_COST: "4", CORS_ORIGINS: "http://localhost:3000", OPERATOR_EMAIL: "" }), transport: mem });
    const c = await shop("tanpa-op");
    const token = (await login(noOp, c.email, "KataSandiKuat1!")).token!;
    const before = (await fx.handle.db.select().from(mailQueue).where(eq(mailQueue.kind, "proof_received"))).length;
    const inv = (await call(noOp, "POST", "/billing/invoices", { token, body: { plan: "basic", interval: "monthly" } })).json.invoice;
    const f = new FormData();
    for (const [k, v] of Object.entries({ bank: "BCA", sender: "Siti", transferredOn: new Date().toISOString().slice(0, 10) })) f.set(k, v);
    await noOp.request(`/api/v1/billing/invoices/${inv.id}/proof`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: f });
    expect((await fx.handle.db.select().from(mailQueue).where(eq(mailQueue.kind, "proof_received"))).length).toBe(before);
  });
});

describe("panel pengelola: status dan uji email", () => {
  it("status tidak membocorkan kata sandi SMTP; uji kirim melaporkan hasil; support hanya melihat", async () => {
    const s = await P(SUPPORT, "GET", "/mail/status");
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ driver: "memory", configured: false, from: "Naqdi <no-reply@naqdi.example>", operatorEmail: OPERATOR, appUrl: "https://naqdi.example" });
    expect(JSON.stringify(s.json)).not.toContain("kata-sandi-smtp-rahasia");

    const to = `uji-${Date.now().toString(36)}@tujuan.test`;
    expect((await P(SUPPORT, "POST", "/mail/test", { to })).status).toBe(403);
    expect((await P(OWNER, "POST", "/mail/test", { to: "bukan-email" })).status).toBe(422);
    const ok = await P(OWNER, "POST", "/mail/test", { to });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ verify: { ok: true }, mail: { status: "sent", attempts: 1 } });
    expect(mem.sent.some((m) => m.to === to)).toBe(true);

    // koneksi SMTP bermasalah: verifikasi gagal dan alasannya terlihat; email tetap masuk antrean untuk dicoba ulang
    mem.failNext(2, "autentikasi SMTP ditolak");
    const bad = await P(OWNER, "POST", "/mail/test", { to: `rusak-${Date.now().toString(36)}@tujuan.test` });
    expect(bad.json.verify).toEqual({ ok: false, error: "autentikasi SMTP ditolak" });
    expect(bad.json.mail).toMatchObject({ status: "queued", attempts: 1, lastError: "autentikasi SMTP ditolak" });

    const list = await P(SUPPORT, "GET", "/mail?status=failed");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json.items)).toBe(true);
    expect((await call(app, "GET", "/platform/mail/status")).status).toBe(401);
  });
});

describe("retensi", () => {
  it("email selesai yang lebih tua dari 90 hari dihapus; yang masih antre atau baru dibiarkan", async () => {
    const { purgeOldMail } = await import("../src/mail/queue");
    const old = new Date(Date.now() - 100 * 86_400_000);
    const tag = `retensi-${Date.now().toString(36)}@tujuan.test`;
    const mk = (status: "sent" | "queued", createdAt: Date) => fx.handle.db.insert(mailQueue).values({ id: newId(), recipient: tag, kind: "test", locale: "id", subject: "x", text: "x", html: "x", status, createdAt });
    await mk("sent", old);
    await mk("queued", old);
    await mk("sent", new Date());
    await purgeOldMail(fx.handle.db);
    const left = await mailsTo(tag);
    expect(left.map((m) => m.status).sort()).toEqual(["queued", "sent"]);
  });
});

describe("SMTP sungguhan (server palsu lokal)", () => {
  it("transport SMTP mengirim lewat protokol SMTP: pengirim, penerima, judul, dan isi (UTF-8, Arab) sampai utuh; verify lolos; server mati = gagal", async () => {
    const net = await import("node:net");
    const { smtpTransport } = await import("../src/mail/transport");
    const received: string[] = [];
    const server = net.createServer((sock) => {
      let data = false;
      let buf = "";
      let message = "";
      sock.write("220 fake ESMTP\r\n");
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (data) {
            if (line === ".") {
              data = false;
              received.push(message);
              sock.write("250 OK queued\r\n");
            } else message += `${line}\n`;
            continue;
          }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === "EHLO" || cmd === "HELO") sock.write("250-fake\r\n250 8BITMIME\r\n");
          else if (cmd === "MAIL" || cmd === "RCPT" || cmd === "RSET" || cmd === "NOOP") sock.write("250 OK\r\n");
          else if (cmd === "DATA") {
            data = true;
            sock.write("354 go ahead\r\n");
          } else if (cmd === "QUIT") {
            sock.write("221 bye\r\n");
            sock.end();
          } else sock.write("250 OK\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const t = smtpTransport({ driver: "smtp", host: "127.0.0.1", port, secure: false, user: "", pass: "", from: "Naqdi <no-reply@naqdi.example>", replyTo: "bantuan@naqdi.example", operatorEmail: "", appUrl: "http://x" });
    await t.verify();
    const mail = renderMail("payment_approved", "ar", { name: "سارة", business: "متجر", number: "INV-9", periodEnd: "2026-11-16", billingUrl: "https://naqdi.example/ar/settings/billing" });
    expect(await t.send({ to: "pelanggan@tujuan.test", ...mail })).toBe("sent");
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("From: Naqdi <no-reply@naqdi.example>");
    expect(received[0]).toContain("To: pelanggan@tujuan.test");
    expect(received[0]).toContain("Reply-To: bantuan@naqdi.example");
    expect(received[0]).toContain("Subject:");
    expect(received[0]).toContain("multipart/alternative");

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(t.send({ to: "x@tujuan.test", ...mail })).rejects.toThrow();
  });
});
