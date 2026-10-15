// Verifikasi browser panel pengelola platform: masuk, ringkasan, daftar + cari, buat bisnis (kata sandi tampil sekali),
// perpanjang uji coba, tangguhkan dengan alasan, peran support hanya-lihat, kata sandi salah ditolak, dan tampilan Arab (RTL).
// Prasyarat: API + web PRODUKSI berjalan, dan dua pengelola sudah dibuat dengan `npm run platform:create-admin`:
//   PLATFORM_OWNER_EMAIL/PLATFORM_OWNER_PASSWORD (peran owner) dan PLATFORM_SUPPORT_EMAIL/PLATFORM_SUPPORT_PASSWORD (peran support, opsional).
import { chromium } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3100";
const out = fileURLToPath(new URL("../build/web-shots-platform", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const OWNER = { email: process.env.PLATFORM_OWNER_EMAIL ?? "ops@naqdi.test", password: process.env.PLATFORM_OWNER_PASSWORD ?? "PlatformOps123!" };
const SUPPORT = process.env.PLATFORM_SUPPORT_EMAIL ? { email: process.env.PLATFORM_SUPPORT_EMAIL, password: process.env.PLATFORM_SUPPORT_PASSWORD ?? "" } : null;
const run = Date.now().toString(36).slice(-5);
const NAME = `Toko Uji ${run}`;

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const problems = [];
const newPage = async (viewport = { width: 1280, height: 900 }) => {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on("pageerror", (e) => problems.push(e.message));
  return p;
};
const login = async (p, who, locale = "id") => {
  await p.goto(`${base}/${locale}/platform/login`, { waitUntil: "networkidle" });
  await p.getByTestId("platform-email").fill(who.email);
  await p.getByTestId("platform-password").fill(who.password);
  await p.getByTestId("platform-submit").click();
};

// 1. kata sandi salah
{
  const p = await newPage();
  await login(p, { email: OWNER.email, password: "salah-salah-salah" });
  await p.getByTestId("platform-login-error").waitFor({ timeout: 8000 }).catch(() => {});
  check("kata sandi salah ditolak dengan pesan", await p.getByTestId("platform-login-error").isVisible());
  check("tetap di halaman masuk", p.url().includes("/platform/login"));
}

// 2. owner
const p = await newPage();
await login(p, OWNER);
await p.getByTestId("platform-overview").waitFor({ timeout: 10000 }).catch(() => {});
check("masuk -> ringkasan tampil", await p.getByTestId("platform-overview").isVisible());
await p.screenshot({ path: `${out}/overview.png`, fullPage: true });

const token = await p.evaluate(() => Object.values(sessionStorage).join("|"));
check("token pengelola hanya di sessionStorage (bukan localStorage)", token.length > 20 && (await p.evaluate(() => localStorage.length)) === 0);

await p.goto(`${base}/id/platform/businesses`, { waitUntil: "networkidle" });
check("daftar bisnis tampil", (await p.getByTestId("biz-row").count()) > 0);

// buat bisnis
await p.getByTestId("biz-create").click();
await p.getByTestId("f-name").fill(NAME);
await p.getByTestId("f-email").fill(`uji-${run}@toko.test`);
await p.getByTestId("biz-save").click();
await p.getByTestId("biz-created").waitFor({ timeout: 10000 }).catch(() => {});
check("bisnis dibuat; kata sandi acak ditampilkan sekali", (await p.getByTestId("biz-created-password").textContent().catch(() => ""))?.length >= 10);

// cari
await p.getByTestId("biz-search").fill(NAME);
await p.waitForTimeout(900);
check("pencarian menyaring ke bisnis baru", (await p.getByTestId("biz-row").count()) === 1);
await p.getByTestId("biz-row").getByRole("link", { name: NAME }).click();
await p.getByTestId("biz-detail").waitFor({ timeout: 10000 }).catch(() => {});
check("halaman detail terbuka", await p.getByTestId("biz-detail").isVisible());

// perpanjang uji coba
const before = await p.getByTestId("biz-info").innerText();
await p.getByTestId("a-note").fill("perpanjang uji");
await p.getByTestId("a-extend").fill("7");
await p.getByTestId("a-extend-go").click();
await p.waitForTimeout(1200);
const after = await p.getByTestId("biz-info").innerText();
check("perpanjang uji coba mengubah tanggal berakhir", before !== after);

// tangguhkan
await p.getByTestId("a-status").selectOption("suspended");
await p.getByTestId("a-reason").fill("uji tangguh");
await p.getByTestId("a-status-go").click();
await p.waitForTimeout(1200);
check("status menjadi ditangguhkan (terkunci)", (await p.locator("h1").locator("..").innerText()).includes("Ditangguhkan"));
check("riwayat mencatat tindakan", (await p.getByTestId("biz-history").locator("li").count()) >= 2);
await p.screenshot({ path: `${out}/detail.png`, fullPage: true });

await p.goto(`${base}/id/platform/audit`, { waitUntil: "networkidle" });
check("jejak audit memuat baris", (await p.getByTestId("audit-row").count()) >= 2);

// 3. RTL
await p.goto(`${base}/ar/platform/businesses`, { waitUntil: "networkidle" });
check("tampilan Arab: dir=rtl", (await p.evaluate(() => document.documentElement.dir)) === "rtl");
check("tampilan Arab: tanpa overflow horizontal", await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await p.screenshot({ path: `${out}/ar.png`, fullPage: true });

// 4. halaman terlindungi tanpa sesi
{
  const q = await newPage();
  await q.goto(`${base}/id/platform/businesses`, { waitUntil: "networkidle" });
  check("tanpa sesi: dialihkan ke halaman masuk", q.url().includes("/platform/login"));
}

// 5. support hanya-lihat
if (SUPPORT) {
  const s = await newPage();
  await login(s, SUPPORT);
  await s.getByTestId("platform-overview").waitFor({ timeout: 10000 }).catch(() => {});
  await s.goto(`${base}/id/platform/businesses`, { waitUntil: "networkidle" });
  check("support: tombol buat bisnis tidak ada", (await s.getByTestId("biz-create").count()) === 0);
  await s.getByTestId("biz-row").first().getByRole("link").first().click();
  await s.getByTestId("biz-detail").waitFor({ timeout: 10000 }).catch(() => {});
  check("support: panel tindakan tidak ada", (await s.getByTestId("biz-actions").count()) === 0);
} else {
  console.log("- peran support dilewati (PLATFORM_SUPPORT_EMAIL tidak diset)");
}

check("tanpa galat JavaScript di halaman", problems.length === 0, problems.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} pemeriksaan gagal` : "\nSemua pemeriksaan lolos");
process.exit(failures ? 1 : 0);
