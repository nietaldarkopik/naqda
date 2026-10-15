// Verifikasi browser barcode: kolom barcode di Back Office (validasi EAN-13), lalu scan di kasir dengan scanner mode
// keyboard (ketikan cepat + Enter): tambah item, scan berulang menambah jumlah, kode sendiri, SKU sebagai cadangan, kode
// tidak dikenal, item dengan modifier wajib, ketikan manusia tidak dianggap scan, diam saat dialog bayar terbuka, scan di
// kolom cari, dan scan saat OFFLINE. Prasyarat sama seperti verify_phase8.mjs (API + web PRODUKSI berjalan, data demo).
// Ke mana saja: BASE=http://127.0.0.1:3100 API=http://127.0.0.1:4000/api/v1/ node tools/verify_barcode.mjs
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3000";
const apiBase = process.env.API ?? "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-barcode", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = process.env.DEMO_PASSWORD ?? "Naqdi123!";
const PIN = "482615";

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const ean = (first12) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${first12}${(10 - (sum % 10)) % 10}`;
};

const api = await pwRequest.newContext({ baseURL: apiBase });
const token = (await (await api.post("auth/login", { data: { email: "admin@naqdi.test", password: PASSWORD } })).json()).accessToken;
const H = { authorization: `Bearer ${token}` };
const call = async (method, path, data) => {
  const res = await api.fetch(path, { method, data, headers: H });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
};
const run = Date.now().toString(36).slice(-4);
const digits = String(Date.now()).slice(-9).padStart(9, "0");
const EAN_A = ean(`899${digits}`);
const OWN_B = `KODE-${run}`.toUpperCase();
const EAN_C = ean(`400${digits}`);
const mod = await call("POST", "modifiers", { name: `Wajib ${run}`, minSelect: 1, maxSelect: 1, options: [{ name: "Panas", price: 0 }, { name: "Dingin", price: 1000 }] });
const itemA = await call("POST", "items", { name: `ScanA ${run}`, variants: [{ name: "R", basePrice: 10000, sku: `SA-${run}`, barcode: EAN_A }] });
await call("POST", "items", { name: `ScanB ${run}`, variants: [{ name: "R", basePrice: 5000, sku: `SB-${run}`, barcode: OWN_B }] });
await call("POST", "items", { name: `ScanC ${run}`, variants: [{ name: "R", basePrice: 7000, barcode: EAN_C }], modifierSetIds: [mod.id] });
await call("POST", "items", { name: `ScanD ${run}`, variants: [{ name: "R", basePrice: 3000, sku: `SD-${run}` }] }); // hanya SKU
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const employees = (await call("GET", "employees?pageSize=100")).items;
await call("POST", `employees/${employees.find((e) => e.email === "kasir@naqdi.test").id}/pin`, { pin: PIN });
const dev = await call("POST", "devices", { outletId: (outlets.find((o) => /Pusat/.test(o.name)) ?? outlets[0]).id, name: `Scan ${run}` });

const browser = await chromium.launch();
const problems = [];

// ================================================================ Back Office
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const bo = await ctx.newPage();
  bo.on("pageerror", (e) => problems.push(`BO: ${e.message}`));
  await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
  await bo.fill('input[type="email"]', "admin@naqdi.test");
  await bo.fill('input[type="password"]', PASSWORD);
  await bo.click('button[type="submit"]');
  await bo.waitForURL(/dashboard/);
  await bo.goto(`${base}/id/items`, { waitUntil: "networkidle" });
  await bo.getByPlaceholder(/Cari/).first().fill(`ScanA ${run}`).catch(() => undefined);
  await bo.locator("tr", { hasText: `ScanA ${run}` }).getByRole("button", { name: /Ubah/ }).first().click();
  const field = bo.getByTestId("barcode-0");
  await field.waitFor();
  check("kolom barcode terisi dari data", (await field.inputValue()) === EAN_A);
  await field.fill(EAN_A.slice(0, 12) + String((Number(EAN_A[12]) + 1) % 10)); // digit pemeriksa salah
  await field.press("Enter"); // Enter dari scanner tidak boleh mengirim formulir
  check("Enter di kolom barcode tidak menutup/mengirim formulir", await bo.getByTestId("barcode-0").isVisible());
  await bo.getByRole("button", { name: "Simpan", exact: true }).last().click();
  await bo.getByText(/EAN-13/).first().waitFor({ timeout: 5000 }).then(
    () => check("EAN-13 dengan digit pemeriksa salah ditolak dengan pesan jelas", true),
    () => check("EAN-13 dengan digit pemeriksa salah ditolak dengan pesan jelas", false),
  );
  await bo.screenshot({ path: `${out}/1-backoffice-barcode-error.png` });
  await ctx.close();
}

// ================================================================ Kasir
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push(`POS: ${e.message}`));
await page.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await page.getByLabel("Kode aktivasi").fill(dev.activationCode);
await page.getByRole("button", { name: "Aktifkan" }).click();
await page.getByRole("button", { name: /Kasir/ }).first().click();
for (const d of PIN) await page.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
await page.getByRole("button", { name: "Masuk", exact: true }).click();
await page.getByLabel("Uang di laci saat buka").or(page.getByTestId("cart-total")).first().waitFor();
if (await page.getByLabel("Uang di laci saat buka").isVisible()) {
  await page.getByLabel("Uang di laci saat buka").fill("100000");
  await page.getByRole("button", { name: "Buka shift" }).click();
}
await page.getByRole("button", { name: new RegExp(`ScanA ${run}`) }).first().waitFor();

const lines = () => page.locator('[data-testid="cart-panel"] ul > li').filter({ has: page.locator("button") }).count();
const qtyText = async () => (await page.locator('[data-testid="cart-panel"] ul').textContent()).replace(/\s+/g, " ");
const total = async () => (await page.getByTestId("cart-total").textContent()).replace(/\D/g, "");
const scan = async (code, delay = 6) => {
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // fokus di luar kolom isian
  await page.keyboard.type(code, { delay });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
};

await scan(EAN_A);
check("scan EAN-13 menambah item ke keranjang", (await lines()) === 1 && /ScanA/.test(await qtyText()));
const t1 = await total();
await scan(EAN_A);
check("scan kode yang sama lagi menambah jumlah (bukan baris baru)", (await lines()) === 1 && Number(await total()) > Number(t1));
await scan(OWN_B.toLowerCase());
check("kode buatan sendiri dikenali (tidak peka huruf besar-kecil)", (await lines()) === 2 && /ScanB/.test(await qtyText()));
await scan(`sd-${run}`);
check("SKU dipakai sebagai cadangan bila barcode tidak ada", (await lines()) === 3 && /ScanD/.test(await qtyText()));
await page.screenshot({ path: `${out}/2-pos-after-scans.png` });

const before = await total();
await scan("9999999999994");
check("kode tidak dikenal: keranjang tidak berubah, ada pesan", (await total()) === before && (await page.getByText(/tidak dikenal/).first().isVisible()));

await scan(EAN_C);
check("item dengan modifier wajib membuka dialog pilihan, tidak langsung masuk", await page.getByRole("dialog").isVisible());
await page.getByRole("dialog").getByText("Panas").click();
await page.getByRole("dialog").getByRole("button", { name: /^Tambah ·/ }).click();
await page.waitForFunction((n) => document.querySelector('[data-testid="cart-panel"] ul')?.textContent?.includes(n), `ScanC ${run}`, { timeout: 5000 }).catch(() => undefined);
check("setelah memilih opsi, item masuk keranjang", /ScanC/.test(await qtyText()));

// ketikan manusia (lambat) bukan scan
const n = await lines();
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.type(EAN_A, { delay: 120 });
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check("mengetik manual lambat tidak dianggap scan", (await lines()) === n);

// scan di kolom cari: menambah dan mengosongkan kolom
await page.getByTestId("search-items").click();
await page.keyboard.type(OWN_B, { delay: 6 });
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
check("scan saat kursor di kolom cari: menambah item dan mengosongkan kolom", (await page.getByTestId("search-items").inputValue()) === "");

// dialog bayar terbuka: scan diabaikan
await page.getByRole("button", { name: "Bayar", exact: true }).click();
await page.getByTestId("confirm-pay").waitFor();
const dueBefore = (await page.getByTestId("amount-due").textContent()).replace(/\D/g, "");
await page.keyboard.type(EAN_A, { delay: 6 });
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check("scan saat dialog bayar terbuka diabaikan (tagihan tidak berubah)", (await page.getByTestId("amount-due").textContent()).replace(/\D/g, "") === dueBefore);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// OFFLINE: katalog sudah di perangkat, scan tetap bekerja
await ctx.setOffline(true);
await page.getByTestId("offline-banner").waitFor();
const q0 = await total();
await scan(EAN_A);
check("keranjang bertambah saat offline", Number(await total()) > Number(q0));
await page.screenshot({ path: `${out}/3-pos-offline-scan.png` });
await ctx.setOffline(false);

check("tanpa galat halaman", problems.length === 0, problems.slice(0, 2).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
process.exit(failures === 0 ? 0 : 1);
