// Verifikasi browser pendaftaran mandiri: tautan dari login, isi otomatis negara -> mata uang/zona waktu, tombol daftar nonaktif
// tanpa persetujuan, pendaftaran lalu langsung masuk dengan spanduk uji coba 14 hari, email ganda ditolak, halaman ketentuan
// bertanda DRAF, tampilan Arab (RTL), dan mode dimatikan.
// Prasyarat: API + web PRODUKSI berjalan. Untuk uji "diaktifkan" jalankan API dengan SIGNUP_ENABLED=true (di produksi bawaannya mati);
// untuk uji "dimatikan" set EXPECT_DISABLED=1 dan jalankan API dengan SIGNUP_ENABLED=false.
import { chromium } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3000";
const out = fileURLToPath(new URL("../build/web-shots-signup", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const expectDisabled = process.env.EXPECT_DISABLED === "1";
const run = Date.now().toString(36).slice(-5);
const EMAIL = `daftar-${run}@uji.test`;
const PASSWORD = "KataSandiKuat1!";

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const problems = [];

if (expectDisabled) {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
  await p.goto(`${base}/id/register`, { waitUntil: "networkidle" });
  check("pendaftaran dimatikan: halaman menampilkan pemberitahuan, bukan formulir", (await p.getByTestId("signup-disabled").isVisible()) && (await p.getByTestId("register-form").count()) === 0);
  await p.screenshot({ path: `${out}/0-disabled.png` });
  await browser.close();
  console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: "Asia/Riyadh", locale: "en-US" });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push(e.message));

await page.goto(`${base}/en/login`, { waitUntil: "networkidle" });
await page.getByTestId("login-register-link").click();
await page.waitForURL(/\/en\/register/);
check("tautan 'Daftar gratis' di halaman login membuka pendaftaran", true);

const form = page.getByTestId("register-form");
await form.waitFor();
check("negara ditebak dari zona waktu peramban (Riyadh -> Arab Saudi, SAR)", (await page.getByTestId("register-country").inputValue()) === "SA" && (await page.getByTestId("register-currency").inputValue()) === "SAR" && (await page.getByTestId("register-timezone").inputValue()) === "Asia/Riyadh");
check("catatan uji coba 14 hari tampil", (await page.getByText(/14 days/).count()) > 0);
const trap = await page.locator('input[tabindex="-1"]').boundingBox();
const vw = page.viewportSize().width;
check("kolom jebakan berada di luar layar dan tersembunyi dari pembaca layar", trap === null || trap.x + trap.width < 0 || trap.x > vw, trap ? `x=${Math.round(trap.x)}` : "tanpa kotak");
check("kolom jebakan tidak bisa difokus lewat Tab", (await page.locator('input[tabindex="-1"]').getAttribute("tabindex")) === "-1" && (await page.locator('[aria-hidden="true"] input[tabindex="-1"]').count()) === 1);

await page.getByRole("textbox", { name: "Business name" }).fill(`Kedai Uji ${run}`);
await page.getByRole("textbox", { name: "Your name" }).fill("Ahmad");
await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
await page.getByLabel("Password").fill(PASSWORD);
check("tombol daftar nonaktif sebelum menyetujui ketentuan", await page.getByTestId("register-submit").isDisabled());
await page.getByTestId("register-country").selectOption("ID");
check("memilih Indonesia mengisi rupiah dan zona Jakarta", (await page.getByTestId("register-currency").inputValue()) === "IDR" && (await page.getByTestId("register-timezone").inputValue()) === "Asia/Jakarta");
await page.getByTestId("register-country").selectOption("US");
check("memilih Amerika Serikat mengisi dolar AS", (await page.getByTestId("register-currency").inputValue()) === "USD");
await page.getByTestId("register-currency").selectOption("SAR"); // pendaftar boleh mengganti
await page.getByTestId("register-terms").check();
check("setelah menyetujui, tombol aktif", await page.getByTestId("register-submit").isEnabled());
await page.screenshot({ path: `${out}/1-form.png` });

// ketentuan membuka halaman draf
const [terms] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("link", { name: "terms of service" }).click()]);
await terms.waitForLoadState("domcontentloaded");
check("ketentuan layanan terbuka dan jelas bertanda DRAF", await terms.getByTestId("legal-draft").isVisible());
await terms.close();

await page.getByTestId("register-submit").click();
await page.waitForURL(/\/en\/dashboard/, { timeout: 20000 });
check("setelah mendaftar langsung masuk ke dashboard", true);
const banner = (await page.getByTestId("billing-banner").textContent()) ?? "";
check("spanduk uji coba menampilkan sisa 14 hari", /14 days/.test(banner), banner.trim());
await page.screenshot({ path: `${out}/2-dashboard.png` });

await page.goto(`${base}/en/settings/account`, { waitUntil: "networkidle" });
check("mata uang yang dipilih tersimpan (SAR) dan masih bisa diganti sebelum ada data", (await page.getByTestId("currency-select").inputValue()) === "SAR" && (await page.getByTestId("currency-select").isEnabled()));

// email yang sama
const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 1000 }, locale: "en-US" });
const p2 = await ctx2.newPage();
await p2.goto(`${base}/en/register`, { waitUntil: "networkidle" });
await p2.getByRole("textbox", { name: "Business name" }).fill(`Kedai Lain ${run}`);
await p2.getByRole("textbox", { name: "Your name" }).fill("Ahmad Lagi");
await p2.getByRole("textbox", { name: "Email" }).fill(EMAIL.toUpperCase());
await p2.getByLabel("Password").fill(PASSWORD);
await p2.getByTestId("register-terms").check();
await p2.getByTestId("register-submit").click();
await p2.getByText(/already registered/i).waitFor({ timeout: 8000 }).then(
  () => check("email yang sama (huruf besar) ditolak dengan pesan di kolom email", true),
  () => check("email yang sama (huruf besar) ditolak dengan pesan di kolom email", false),
);
await ctx2.close();

// Arab (RTL)
const ar = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
await ar.goto(`${base}/ar/register`, { waitUntil: "networkidle" });
check("halaman daftar Arab memakai dir=rtl", (await ar.evaluate(() => document.documentElement.dir)) === "rtl");
check("tanpa gulir horizontal di ponsel (Arab)", !(await ar.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
await ar.screenshot({ path: `${out}/3-arabic-mobile.png` });

check("tanpa galat halaman", problems.length === 0, problems.slice(0, 2).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
process.exit(failures === 0 ? 0 : 1);
