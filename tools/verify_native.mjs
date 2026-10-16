// Verifikasi browser jalur "aplikasi native" kasir TANPA perangkat Android: cangkang disimulasikan dengan menyuntikkan adapter
// perangkat keras tiruan (window.__NAQDI_HARDWARE__). Memeriksa: tombol printer dan pemindai kamera hanya muncul di cangkang,
// pemindaian kamera menambah item ke keranjang, pemilihan printer + uji cetak, byte ESC/POS yang dikirim (inisialisasi, perintah
// raster GS v 0 selebar kertas, isi tidak kosong, potong kertas), cetak otomatis setelah bayar, cetak manual, dan pesan galat saat
// printer gagal. BUKAN pengganti uji di tablet Android dengan printer Bluetooth sungguhan.
// Prasyarat: API + web PRODUKSI berjalan, data demo (admin@naqdi.test / kasir PIN), Playwright.
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3100";
const apiBase = process.env.API ?? "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-native", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = process.env.DEMO_PASSWORD ?? "Naqdi123!";
const PIN = "482615";

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
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
const SKU = `N-${run}`;
await call("POST", "items", { name: `Teh ${run}`, variants: [{ name: "R", basePrice: 12000, sku: SKU }] });
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const pusat = outlets.find((o) => /Pusat/.test(o.name)) ?? outlets[0];
const employees = (await call("GET", "employees?pageSize=100")).items;
await call("POST", `employees/${employees.find((e) => e.email === "kasir@naqdi.test").id}/pin`, { pin: PIN });
const dev = await call("POST", "devices", { outletId: pusat.id, name: `native ${run}` });

const browser = await chromium.launch();
process.on("uncaughtException", (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  process.exit(1);
});

// Adapter tiruan: mencatat pekerjaan cetak sebagai array angka; bisa dipaksa gagal; pemindaian mengembalikan nilai terjadwal.
const mockHardware = () => {
  window.__printed = [];
  window.__failPrint = false;
  window.__nextScan = null;
  window.__NAQDI_HARDWARE__ = {
    platform: "tiruan",
    canPrintDirect: true,
    canScanCamera: true,
    listPrinters: async () => {
      await new Promise((r) => setTimeout(r, 150));
      return [{ id: "AA:BB:CC:DD:EE:FF", name: "RPP02N" }, { id: "11:22:33:44:55:66", name: "Xprinter" }];
    },
    printReceipt: async (printer, job) => {
      if (window.__failPrint) throw new Error("bluetooth putus");
      window.__printed.push({ printer, job: job.map((p) => Array.from(p)) });
    },
    scanBarcode: async () => window.__nextScan,
  };
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(mockHardware);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await page.locator('input[autocomplete="off"]').fill(dev.activationCode);
await page.locator("form button[type=submit], form button").last().click();
await page.getByRole("button", { name: /Kasir/ }).first().waitFor();
await page.getByRole("button", { name: /Kasir/ }).first().click();
for (const d of PIN) await page.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
await page.locator("div[dir=ltr] button").last().click();
await page.getByLabel(/./).first().waitFor();
if (await page.locator("input[inputmode=decimal]").isVisible().catch(() => false)) {
  await page.locator("input[inputmode=decimal]").fill("100000");
  await page.locator("form button[type=submit]").click();
}
await page.getByRole("button", { name: new RegExp(`Teh ${run}`) }).first().waitFor();

check("cangkang native: tombol printer dan pemindai kamera tampil", (await page.getByTestId("printer-open").isVisible()) && (await page.getByTestId("scan-camera").isVisible()));

// ---- pemindai kamera
await page.evaluate((sku) => (window.__nextScan = sku), SKU);
await page.getByTestId("scan-camera").click();
await page.waitForFunction(() => (document.querySelector('[data-testid="cart-total"]')?.textContent ?? "").replace(/\D/g, "") !== "0" && document.querySelector('[data-testid="cart-total"]') !== null, null, { timeout: 5000 }).catch(() => undefined);
const totalAfterScan = (await page.getByTestId("cart-total").textContent()).replace(/\D/g, "");
check("pindai kamera menambah item ke keranjang (total > 0)", Number(totalAfterScan) >= 12000, totalAfterScan);
await page.evaluate(() => (window.__nextScan = "TIDAK-ADA-999"));
await page.getByTestId("scan-camera").click();
await page.waitForTimeout(500);
check("kode tidak dikenal: keranjang tidak berubah", (await page.getByTestId("cart-total").textContent()).replace(/\D/g, "") === totalAfterScan);

// ---- pilih printer + uji cetak
await page.getByTestId("printer-open").click();
await page.getByTestId("printer-dialog").waitFor();
check("belum ada printer terpilih", (await page.getByTestId("printer-selected").innerText()).includes("Belum"));
await page.getByTestId("printer-scan").click();
await page.getByTestId("printer-pick").first().waitFor({ timeout: 5000 });
check("hasil pencarian menampilkan dua printer", (await page.getByTestId("printer-pick").count()) === 2);
await page.getByTestId("printer-pick").first().click();
check("printer terpilih tampil", (await page.getByTestId("printer-selected").innerText()).includes("RPP02N"));
await page.getByTestId("printer-test").click();
await page.waitForFunction(() => window.__printed.length === 1, null, { timeout: 5000 }).catch(() => undefined);
const printed = () => page.evaluate(() => window.__printed);
let jobs = await printed();
check("uji cetak terkirim ke printer yang dipilih", jobs.length === 1 && jobs[0].printer.id === "AA:BB:CC:DD:EE:FF");
const analyze = (job) => {
  const flat = job.flat();
  const init = flat[0] === 0x1b && flat[1] === 0x40;
  const idx = flat.findIndex((v, i) => v === 0x1d && flat[i + 1] === 0x76 && flat[i + 2] === 0x30 && flat[i + 3] === 0x00);
  const bytesPerRow = idx >= 0 ? flat[idx + 4] + flat[idx + 5] * 256 : 0;
  let inked = 0;
  for (const part of job.slice(2)) if (part[0] === 0x1d && part[1] === 0x76) for (const b of part.slice(8)) inked += b.toString(2).replace(/0/g, "").length;
  const tail = flat.slice(-4);
  return { init, bytesPerRow, inked, cut: tail[0] === 0x1d && tail[1] === 0x56 };
};
let a = analyze(jobs[0].job);
check("byte: diawali ESC @ dan perintah raster GS v 0", a.init && a.bytesPerRow > 0);
check("byte: lebar raster = 72 byte (80 mm, 576 titik)", a.bytesPerRow === 72, `bytesPerRow=${a.bytesPerRow}`);
check("byte: gambar berisi titik hitam (tidak kosong) dan diakhiri potong kertas", a.inked > 200 && a.cut, `titik=${a.inked}`);
await page.screenshot({ path: `${out}/1-printer-dialog.png` });

// ---- cetak otomatis setelah bayar
await page.getByTestId("printer-auto").check();
await page.getByTestId("printer-close").click();
await page.locator('[data-testid="cart-panel"] button', { hasText: /^Bayar$/ }).first().click();
await page.getByTestId("confirm-pay").waitFor();
await page.getByRole("dialog").locator("button", { hasText: /^(Pas|Exact)$/ }).first().click();
await page.getByTestId("confirm-pay").click();
await page.getByTestId("receipt").waitFor();
await page.waitForFunction(() => window.__printed.length === 2, null, { timeout: 8000 }).catch(() => undefined);
jobs = await printed();
check("cetak otomatis: struk dikirim sekali setelah bayar", jobs.length === 2, `jumlah=${jobs.length}`);
if (jobs[1]) {
  a = analyze(jobs[1].job);
  check("struk tercetak berisi gambar (teks struk ter-raster), bukan kosong", a.inked > 1500 && a.bytesPerRow === 72, `titik=${a.inked}`);
}
await page.screenshot({ path: `${out}/2-receipt.png` });

// ---- cetak manual dan galat
await page.getByTestId("receipt-print").click();
await page.waitForFunction(() => window.__printed.length === 3, null, { timeout: 5000 }).catch(() => undefined);
check("tombol Cetak mengirim ulang struk", (await printed()).length === 3);
await page.evaluate(() => (window.__failPrint = true));
await page.getByTestId("receipt-print").click();
await page.getByText("Terjadi kesalahan pada printer").waitFor({ timeout: 4000 }).catch(() => undefined);
check("printer gagal: pesan galat ramah tampil", await page.getByText("Terjadi kesalahan pada printer").isVisible().catch(() => false));
check("printer gagal: struk di layar tetap ada dan bisa ditutup", await page.getByTestId("receipt").isVisible());
await page.getByTestId("receipt-close").click();

// ---- pilihan printer diingat di perangkat
const stored = await page.evaluate(() => localStorage.getItem("naqdi.printer"));
check("pilihan printer dan cetak otomatis tersimpan di perangkat", Boolean(stored) && stored.includes("RPP02N") && stored.includes('"autoPrint":true'));

check("tanpa galat halaman", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} pemeriksaan gagal` : "\nSemua pemeriksaan lolos");
process.exit(failures ? 1 : 0);
