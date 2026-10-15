// Verifikasi browser mata uang: membuat bisnis baru lewat CLI (npm run db:create-business) untuk beberapa mata uang, lalu
// memeriksa di Back Office (pemilih mata uang) dan kasir (format, total, tombol uang cepat, struk) pada bahasa antarmuka berbeda.
// Rupiah harus tetap "Rp 18.000" juga di antarmuka Inggris; dolar "$12.37"; riyal Saudi memakai simbol riyal di antarmuka Arab.
// Prasyarat sama seperti verify_phase8.mjs (API + web PRODUKSI berjalan). Menambah bisnis uji di database (aman, terpisah).
// BASE dan API dapat diganti lewat environment.
import { chromium, request as pwRequest } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3000";
const apiBase = process.env.API ?? "http://127.0.0.1:4000/api/v1/";
const root = fileURLToPath(new URL("..", import.meta.url));
const out = fileURLToPath(new URL("../build/web-shots-currency", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = "KataSandiKuat1!";
const PIN = "739206";
const run = Date.now().toString(36).slice(-5);

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const norm = (s) => s.replace(/[  ‏‎]/g, " ").replace(/\s+/g, " ").trim();

const cases = [
  { code: "USD", locale: "en", tz: "America/New_York", price: 1237, taxBp: 825, symbol: /^\$[\d,]+\.\d{2}$/, quickMaxMajor: 500 },
  { code: "SAR", locale: "ar", tz: "Asia/Riyadh", price: 1250, taxBp: 1500, symbol: /^[\d,]+\.\d{2} ر\.س\.$/, quickMaxMajor: 1000 },
  { code: "IDR", locale: "en", tz: "Asia/Jakarta", price: 18000, taxBp: 1100, symbol: /^Rp [\d.]+$/, quickMaxMajor: 1_000_000 },
  { code: "AUD", locale: "en", tz: "Australia/Sydney", price: 950, taxBp: 1000, symbol: /^A\$[\d,]+\.\d{2}$/, quickMaxMajor: 500 },
];

const browser = await chromium.launch();
const problems = [];

for (const c of cases) {
  console.log(`\n== ${c.code} (antarmuka ${c.locale})`);
  const email = `owner-${c.code.toLowerCase()}-${run}@uji.test`;
  const made = spawnSync("npm", ["run", "db:create-business", "--", "--name", `"Toko ${c.code} ${run}"`, "--currency", c.code, "--timezone", c.tz, "--locale", c.locale, "--admin-email", email, "--admin-password", PASSWORD, "--admin-name", "Administrator"], { cwd: root, shell: true, encoding: "utf8" });
  check("CLI membuat bisnis baru", made.status === 0 && /dibuat/.test(made.stdout), (made.stdout + made.stderr).split(/\r?\n/).find((l) => /dibuat|sudah|mata uang/.test(l)) ?? "");

  const api = await pwRequest.newContext({ baseURL: apiBase });
  const token = (await (await api.post("auth/login", { data: { email, password: PASSWORD } })).json()).accessToken;
  const H = { authorization: `Bearer ${token}` };
  const call = async (method, path, data) => {
    const res = await api.fetch(path, { method, data, headers: H });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${text}`);
    return text ? JSON.parse(text) : null;
  };

  // ---- Back Office: pemilih mata uang pada bisnis yang masih kosong
  const ctxBo = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const bo = await ctxBo.newPage();
  bo.on("pageerror", (e) => problems.push(`${c.code} BO: ${e.message}`));
  await bo.goto(`${base}/${c.locale}/login`, { waitUntil: "networkidle" });
  await bo.fill('input[type="email"]', email);
  await bo.fill('input[type="password"]', PASSWORD);
  await bo.click('button[type="submit"]');
  await bo.waitForURL(/dashboard/);
  await bo.goto(`${base}/${c.locale}/settings/account`, { waitUntil: "networkidle" });
  const select = bo.getByTestId("currency-select");
  await select.waitFor();
  check("pemilih mata uang aktif dan menampilkan mata uang bisnis", (await select.isEnabled()) && (await select.inputValue()) === c.code);
  const optionCount = await select.locator("option").count();
  check("daftar mata uang memuat rupiah, dolar-dolar, dan riyal", optionCount >= 20 && (await select.locator("option", { hasText: "SAR" }).count()) === 1 && (await select.locator("option", { hasText: "NZD" }).count()) === 1);
  await bo.screenshot({ path: `${out}/${c.code}-1-account.png` });

  // ---- data awal setelah pemeriksaan (mengunci mata uang)
  await call("POST", "taxes", { name: "Pajak", rateBp: c.taxBp, allOutlets: true });
  await call("POST", "items", { name: `Barang ${c.code}`, variants: [{ name: "R", basePrice: c.price }] });
  const employees = (await call("GET", "employees?pageSize=10")).items;
  await call("POST", `employees/${employees[0].id}/pin`, { pin: PIN });
  const outlets = (await call("GET", "outlets?pageSize=10")).items;
  const dev = await call("POST", "devices", { outletId: outlets[0].id, name: `T-${c.code}` });

  await bo.reload({ waitUntil: "networkidle" });
  await bo.getByTestId("currency-select").waitFor();
  check("setelah ada item, pemilih terkunci", !(await bo.getByTestId("currency-select").isEnabled()));
  await ctxBo.close();

  // ---- Kasir
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${c.code} POS: ${e.message}`));
  await page.goto(`${base}/${c.locale}/pos`, { waitUntil: "networkidle" });
  await page.locator('input[autocomplete="off"]').fill(dev.activationCode);
  await page.locator("form button").last().click();
  await page.getByRole("button", { name: /Administrator/ }).first().waitFor();
  await page.getByRole("button", { name: /Administrator/ }).first().click();
  for (const d of PIN) await page.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
  await page.locator("div[dir=ltr] button").last().click();
  await page.locator("input[inputmode=decimal]").waitFor();
  await page.locator("input[inputmode=decimal]").fill("100");
  await page.locator("form button[type=submit]").click();
  await page.getByRole("button", { name: new RegExp(`Barang ${c.code}`) }).first().waitFor();

  const priceOnTile = norm(await page.getByRole("button", { name: new RegExp(`Barang ${c.code}`) }).first().textContent());
  check("harga di kartu produk memakai format mata uang", c.symbol.test(priceOnTile.split(`Barang ${c.code}`).pop().trim()), priceOnTile);
  await page.getByRole("button", { name: new RegExp(`Barang ${c.code}`) }).first().click();
  await page.getByRole("button", { name: new RegExp(`Barang ${c.code}`) }).first().click();
  await page.waitForFunction(() => (document.querySelector('[data-testid="cart-total"]')?.textContent ?? "").replace(/\D/g, "") !== "0");
  await page.waitForTimeout(300);
  const totalText = norm(await page.getByTestId("cart-total").textContent());
  check("total keranjang memakai format mata uang", c.symbol.test(totalText), totalText);
  await page.screenshot({ path: `${out}/${c.code}-2-cart.png` });

  await page.getByRole("button", { name: /^(Bayar|Pay|دفع)$/ }).first().click();
  await page.getByTestId("confirm-pay").waitFor();
  const quick = await page.getByRole("dialog").locator("button.rounded-full").allTextContents();
  const quickMajor = quick.map((q) => Number((norm(q).match(/\d[\d.,]*\d|\d/)?.[0] ?? "NaN").replace(c.code === "IDR" ? /\./g : /,/g, "")));
  check("tombol uang tunai cepat wajar untuk mata uang ini", quick.length >= 2 && quickMajor.every((v) => v > 0 && v <= c.quickMaxMajor), quick.map(norm).join(" | "));
  await page.screenshot({ path: `${out}/${c.code}-3-pay.png` });
  await page.getByRole("dialog").locator("button", { hasText: /^(Pas|Exact|المبلغ بالضبط)$/ }).first().click();
  await page.getByTestId("confirm-pay").click();
  await page.getByTestId("receipt").waitFor();
  const receipt = norm(await page.getByTestId("receipt").textContent());
  check("struk memuat total dalam format mata uang", receipt.includes(totalText), totalText);
  await page.screenshot({ path: `${out}/${c.code}-4-receipt.png` });
  if (c.code !== "IDR") check("struk non-rupiah tidak memuat 'Rp'", !/Rp/.test(receipt));
  await ctx.close();
}

check("tanpa galat halaman", problems.length === 0, problems.slice(0, 2).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
process.exit(failures === 0 ? 0 : 1);
