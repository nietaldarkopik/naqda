// Verifikasi browser alur pembayaran langganan (12D, transfer manual): pelanggan memilih paket dan menerima faktur, kirim bukti
// transfer (dengan gambar), pengelola melihat antrean + gambar, menolak dengan alasan, pelanggan kirim ulang, pengelola menyetujui,
// langganan aktif dengan periode baru. Juga: bisnis terkunci tetap bisa membuka halaman langganan, dan tampilan Arab (RTL).
// Prasyarat: API + web PRODUKSI berjalan, pengelola owner sudah dibuat (`npm run platform:create-admin`).
// Env: BASE (bawaan http://localhost:3100), PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3100";
const out = fileURLToPath(new URL("../build/web-shots-billing", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const OWNER = { email: process.env.PLATFORM_OWNER_EMAIL ?? "ops@naqdi.test", password: process.env.PLATFORM_OWNER_PASSWORD ?? "PlatformOps123!" };
const run = Date.now().toString(36).slice(-5);

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

// PNG 1x1 sungguhan untuk diunggah sebagai bukti.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const proofFile = path.join(os.tmpdir(), `bukti-${run}.png`);
fs.writeFileSync(proofFile, png);

// Siapkan bisnis uji lewat API pengelola.
const login = await fetch(`${base}/api/v1/platform/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(OWNER) });
const { accessToken } = await login.json();
const created = await (await fetch(`${base}/api/v1/platform/businesses`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name: `Toko Bayar ${run}`, currency: "IDR", timezone: "Asia/Jakarta", country: "ID", adminEmail: `bayar-${run}@uji.test`, adminPassword: "KataSandiKuat1!" }) })).json();
const bizId = created.business.id;
const EMAIL = `bayar-${run}@uji.test`;

const browser = await chromium.launch();
const problems = [];
const mk = async (viewport = { width: 1280, height: 900 }) => {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on("pageerror", (e) => problems.push(e.message));
  return p;
};

// ---- pelanggan
const bo = await mk();
await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await bo.fill('input[type="email"]', EMAIL);
await bo.fill('input[type="password"]', "KataSandiKuat1!");
await bo.keyboard.press("Enter");
await bo.waitForURL(/dashboard|\/id\/?$/, { timeout: 15000 }).catch(() => {});
await bo.goto(`${base}/id/settings/billing`, { waitUntil: "networkidle" });
check("halaman langganan tampil", await bo.getByTestId("subscription-page").isVisible());
check("uji coba terlihat di kartu status", (await bo.getByTestId("sub-status").innerText()).includes("Uji coba"));
check("dua paket rupiah dengan harga daftar", (await bo.getByTestId("plan-basic").innerText()).includes("149.000") && (await bo.getByTestId("plan-pro").innerText()).includes("299.000"));
await bo.getByTestId("interval-yearly").click();
check("tahunan: Pro Rp 2.990.000", (await bo.getByTestId("plan-pro").innerText()).includes("2.990.000"));
await bo.getByTestId("choose-pro").click();
await bo.getByTestId("sub-invoice").waitFor({ timeout: 8000 }).catch(() => {});
check("faktur terbit dengan jumlah tepat", (await bo.getByTestId("inv-amount").innerText().catch(() => "")).includes("2.990.000"));
check("rekening belum diisi: ada pesan hubungi pengelola", await bo.getByTestId("inv-bank").isVisible());
await bo.screenshot({ path: `${out}/1-invoice.png`, fullPage: true });

// bukti tanpa isian: ditolak validasi
await bo.getByTestId("proof-submit").click();
await bo.waitForTimeout(600);
check("bukti kosong tidak terkirim", await bo.getByTestId("proof-form").isVisible());

await bo.getByTestId("proof-bank").fill("BCA");
await bo.getByTestId("proof-sender").fill("Budi Santoso");
await bo.getByTestId("proof-file").setInputFiles(proofFile);
await bo.getByTestId("proof-submit").click();
await bo.getByTestId("inv-pending").waitFor({ timeout: 8000 }).catch(() => {});
check("setelah kirim: menunggu verifikasi", await bo.getByTestId("inv-pending").isVisible());
check("rencana paket disembunyikan saat menunggu", (await bo.getByTestId("sub-plans").count()) === 0);

// ---- pengelola
const pl = await mk();
await pl.goto(`${base}/id/platform/login`, { waitUntil: "networkidle" });
await pl.getByTestId("platform-email").fill(OWNER.email);
await pl.getByTestId("platform-password").fill(OWNER.password);
await pl.getByTestId("platform-submit").click();
await pl.getByTestId("platform-overview").waitFor({ timeout: 10000 }).catch(() => {});
check("ringkasan menampilkan pembayaran menunggu (>= 1)", Number(await pl.getByTestId("stat-pending-invoices").innerText()) >= 1);
await pl.goto(`${base}/id/platform/invoices`, { waitUntil: "networkidle" });
const row = pl.getByTestId("inv-row").filter({ hasText: `Toko Bayar ${run}` });
check("antrean memuat faktur pelanggan", (await row.count()) === 1);
await row.click();
await pl.getByTestId("inv-proof-image").waitFor({ timeout: 8000 }).catch(() => {});
check("bukti dan gambar tampil", (await pl.getByTestId("inv-proof").innerText()).includes("Budi Santoso") && (await pl.getByTestId("inv-proof-image").isVisible()));
await pl.screenshot({ path: `${out}/2-review.png` });

await pl.getByTestId("inv-reject").click();
await pl.getByTestId("inv-reject-reason").fill("Jumlah tidak sesuai");
await pl.getByTestId("inv-reject-confirm").click();
await pl.waitForTimeout(1200);
check("ditolak: hilang dari antrean menunggu", (await pl.getByTestId("inv-row").filter({ hasText: `Toko Bayar ${run}` }).count()) === 0);

// ---- pelanggan kirim ulang
await bo.reload({ waitUntil: "networkidle" });
check("alasan penolakan terlihat pelanggan", (await bo.getByTestId("inv-rejected").innerText().catch(() => "")).includes("Jumlah tidak sesuai"));
await bo.getByTestId("proof-bank").fill("Mandiri");
await bo.getByTestId("proof-sender").fill("Budi Santoso");
await bo.getByTestId("proof-submit").click();
await bo.getByTestId("inv-pending").waitFor({ timeout: 8000 }).catch(() => {});
check("kirim ulang berhasil", await bo.getByTestId("inv-pending").isVisible());

await pl.reload({ waitUntil: "networkidle" });
await pl.getByTestId("inv-row").filter({ hasText: `Toko Bayar ${run}` }).click();
await pl.getByTestId("inv-approve").click();
await pl.waitForTimeout(1500);
check("disetujui: antrean tidak lagi memuatnya", (await pl.getByTestId("inv-row").filter({ hasText: `Toko Bayar ${run}` }).count()) === 0);

// ---- langganan aktif
await bo.reload({ waitUntil: "networkidle" });
const statusText = await bo.getByTestId("sub-status").innerText();
check("status Aktif, paket Pro, siklus Tahunan", statusText.includes("Aktif") && statusText.includes("Pro") && statusText.includes("Tahunan"));
check("riwayat memuat faktur Lunas", (await bo.getByTestId("sub-history").innerText()).includes("Lunas"));
await bo.screenshot({ path: `${out}/3-active.png`, fullPage: true });

// ---- Arab (RTL)
await bo.goto(`${base}/ar/settings/billing`, { waitUntil: "networkidle" });
check("Arab: dir=rtl dan tanpa overflow horizontal", (await bo.evaluate(() => document.documentElement.dir)) === "rtl" && (await bo.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)));
await bo.screenshot({ path: `${out}/4-ar.png`, fullPage: true });

// ---- terkunci tetap bisa membuka halaman langganan
await fetch(`${base}/api/v1/platform/businesses/${bizId}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ status: "cancelled" }) });
await bo.goto(`${base}/id/settings/billing`, { waitUntil: "networkidle" });
check("dibatalkan (terkunci): halaman langganan tetap terbuka dengan pilihan paket", (await bo.getByTestId("sub-plans").isVisible()) && (await bo.getByTestId("choose-basic").isVisible()));
await bo.getByTestId("choose-basic").click();
await bo.getByTestId("sub-invoice").waitFor({ timeout: 8000 }).catch(() => {});
check("terkunci tetap bisa membuat faktur", await bo.getByTestId("sub-invoice").isVisible());
await bo.screenshot({ path: `${out}/5-locked.png`, fullPage: true });

check("tanpa galat JavaScript", problems.length === 0, problems.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} pemeriksaan gagal` : "\nSemua pemeriksaan lolos");
process.exit(failures ? 1 : 0);
