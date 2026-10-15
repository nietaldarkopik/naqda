// Verifikasi browser Fase 2: Back Office (PIN, perangkat) + aplikasi kasir (aktivasi, PIN, shift, jual, bayar, struk, tutup shift).
// Prasyarat: API di :4000 dan web di :3000 dengan data demo (kata sandi Rahasia123!). Jalankan pada database yang bersih.
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p2", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = "Rahasia123!";
const PIN = "482615";

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

const problems = [];
const watch = (page, name) => {
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && !/status of (401|403|409|422|423)/.test(m.text()) && problems.push(`${name} console ${m.type()}: ${m.text().slice(0, 300)}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`${name} 5xx: ${r.url()}`));
};

// ---- data awal lewat API (katalog yang dijual)
const api = await pwRequest.newContext({ baseURL: apiBase });
const login = await api.post("auth/login", { data: { email: "admin@naqdi.test", password: PASSWORD } });
const token = (await login.json()).accessToken;
const H = { authorization: `Bearer ${token}` };
const post = async (path, data) => {
  const res = await api.post(path, { data, headers: H });
  if (!res.ok()) throw new Error(`POST ${path}: ${res.status()} ${await res.text()}`);
  return res.json();
};
const get = async (path) => (await api.get(path, { headers: H })).json();

const run = Date.now().toString(36).slice(-4);
await post("taxes", { name: `PPN ${run}`, rateBp: 1100, allOutlets: true });
const mod = await post("modifiers", { name: `Topping ${run}`, minSelect: 0, maxSelect: 2, options: [{ name: "Boba", price: 3000 }, { name: "Jelly", price: 2500 }] });
await post("items", { name: `Kopi ${run}`, variants: [{ name: "R", basePrice: 20000, sku: `KP-${run}` }] });
await post("items", { name: `Teh ${run}`, variants: [{ name: "R", basePrice: 10000, sku: `TH-${run}` }], modifierSetIds: [mod.id] });
await post("discounts", { name: `Staf ${run}`, kind: "percent", value: 1000, allOutlets: true });

const browser = await chromium.launch();
let currentPage = null;
process.on("uncaughtException", async (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  try { await currentPage?.screenshot({ path: `${out}/gagal.png` }); } catch {}
  process.exit(1);
});

// ============================================================ Back Office: PIN + perangkat
const bo = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
watch(bo, "BO");
await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await bo.fill('input[type="email"]', "admin@naqdi.test");
await bo.fill('input[type="password"]', PASSWORD);
await bo.click('button[type="submit"]');
await bo.waitForURL("**/id/dashboard");

await bo.goto(`${base}/id/employees`, { waitUntil: "networkidle" });
await bo.locator("tr", { hasText: "kasir@naqdi.test" }).getByRole("button", { name: /Ubah/ }).click();
await bo.getByLabel("PIN baru").fill("1234");
await bo.getByRole("button", { name: "Simpan PIN" }).click();
await bo.waitForSelector("text=PIN yang mudah ditebak", { timeout: 5000 }).catch(() => undefined);
const weakShown = await bo.locator('[role="alert"]').filter({ hasText: /mudah ditebak/i }).count();
check("PIN lemah (1234) ditolak di form karyawan", weakShown > 0);
await bo.getByLabel("PIN baru").fill(PIN);
await bo.getByRole("button", { name: "Simpan PIN" }).click();
await bo.waitForSelector("text=PIN sudah diatur", { timeout: 5000 });
check("PIN kuat tersimpan, status berubah menjadi 'sudah diatur'", true);
await bo.screenshot({ path: `${out}/01-employee-pin.png` });

await bo.goto(`${base}/id/devices`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Daftarkan perangkat" }).click();
await bo.getByLabel("Outlet").selectOption({ label: "Naqdi Demo - Pusat" });
await bo.getByLabel("Nama perangkat").fill(`Tablet ${run}`);
await bo.getByRole("button", { name: "Buat kode aktivasi" }).click();
await bo.waitForSelector('[data-testid="activation-code"]');
const code = (await bo.locator('[data-testid="activation-code"]').textContent()).trim();
check("kode aktivasi tampil (format XXXX-XXXX)", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);
await bo.screenshot({ path: `${out}/02-device-code.png` });
await bo.getByRole("button", { name: "Tutup" }).first().click();

// Form diskon: sasaran hanya tampil untuk lingkup "item"
await bo.goto(`${base}/id/discounts`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: /Tambah diskon|Buat diskon/i }).first().click();
const targetVisible = () => bo.getByText("Item sasaran").isVisible();
check("form diskon umum tidak menampilkan item sasaran", !(await targetVisible()));
await bo.getByLabel("Berlaku untuk").selectOption("item");
check("memilih lingkup item menampilkan item dan kategori sasaran", (await targetVisible()) && (await bo.getByText("Kategori sasaran").isVisible()));
await bo.screenshot({ path: `${out}/02b-discount-scope.png` });
await bo.keyboard.press("Escape");

// ============================================================ Kasir (tablet)
const cashierCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const pos = await cashierCtx.newPage();
watch(pos, "POS");
currentPage = pos;
await pos.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await pos.screenshot({ path: `${out}/03-activate.png` });
check("perangkat baru meminta kode aktivasi", await pos.getByText("Aktifkan perangkat kasir").isVisible());

await pos.getByLabel("Kode aktivasi").fill("ZZZZ-ZZZZ");
await pos.getByRole("button", { name: "Aktifkan" }).click();
await pos.waitForSelector('p[role="alert"]');
check("kode salah ditolak dengan pesan", await pos.locator('p[role="alert"]').isVisible());

await pos.getByLabel("Kode aktivasi").fill(code);
await pos.getByRole("button", { name: "Aktifkan" }).click();
await pos.waitForSelector("text=Pilih nama Anda");
check("kode benar mengaktifkan perangkat dan menampilkan daftar kasir", true);

const pressPin = async (pin) => {
  for (const d of pin) await pos.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
};
await pos.getByRole("button", { name: /Kasir/ }).first().click();
await pressPin("999999");
await pos.getByRole("button", { name: "Masuk", exact: true }).click();
await pos.waitForSelector('p[role="alert"]');
check("PIN salah ditolak", await pos.locator('p[role="alert"]').isVisible());
await pressPin(PIN);
await pos.getByRole("button", { name: "Masuk", exact: true }).click();
await pos.getByLabel("Uang di laci saat buka").or(pos.getByTestId("cart-total")).first().waitFor();
const needsShift = await pos.getByLabel("Uang di laci saat buka").isVisible();
check("PIN benar masuk (layar buka shift, atau langsung kasir bila shift masih terbuka)", true, needsShift ? "buka shift" : "melanjutkan shift");
if (needsShift) {
  await pos.screenshot({ path: `${out}/04-open-shift.png` });
  await pos.getByLabel("Uang di laci saat buka").fill("100000");
  await pos.getByRole("button", { name: "Buka shift" }).click();
}
await pos.waitForSelector(`text=Kopi ${run}`);
check("shift terbuka, katalog tampil", true);

// Keranjang: 2 kopi + 1 teh dengan topping Boba
await pos.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).click();
await pos.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).click();
await pos.getByRole("button", { name: new RegExp(`Teh ${run}`) }).click();
await pos.getByRole("dialog").getByText("Boba").click();
await pos.getByRole("dialog").getByRole("button", { name: /^Tambah ·/ }).click();
// Harga dihitung server setelah jeda singkat; tunggu sampai angka akhir muncul (atau 10 dtk) sebelum membandingkan.
await pos.waitForFunction(() => /67\.337/.test(document.querySelector('[data-testid="cart-total"]')?.textContent ?? ""), null, { timeout: 10000 }).catch(() => undefined);
// 2x20000 + (10000+3000) = 53000; pajak 11% = 5830; total 58830. Pajak dari run lain pada DB yang sama dapat menambah angka.
const totalText = (await pos.locator('[data-testid="cart-total"]').textContent()).replace(/\s/g, " ");
const digits = Number(totalText.replace(/\D/g, ""));
// Database bersih + data demo (Dine In: service 5%, PB1 10%) + PPN 11% dari skrip ini:
// 53.000 + service 2.650 + pajak 21% x 55.650 (= 11.686,5 -> 11.687) = 67.337
check("total keranjang dihitung server sesuai hitungan manual (67.337)", digits === 67337, totalText);
await pos.screenshot({ path: `${out}/05-cart.png` });

// Bayar tunai dengan uang pas+lebih
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
const dueText = (await pos.locator('[data-testid="amount-due"]').textContent()).replace(/\D/g, "");
check("jumlah tagihan di dialog sama dengan total keranjang", Number(dueText) === digits);
await pos.getByRole("button", { name: "Selesaikan pembayaran" }).isDisabled().then((d) => check("tombol bayar nonaktif sebelum jumlah cukup", d));
await pos.locator("div[role=dialog] button", { hasText: /Rp\s?100\.000/ }).first().click();
const changeText = (await pos.locator('[data-testid="change"]').textContent()).replace(/\D/g, "");
check("kembalian dihitung di dialog", Number(changeText) === 100000 - digits, `kembalian ${changeText}`);
await pos.screenshot({ path: `${out}/06-pay.png` });
await pos.getByTestId("confirm-pay").click();
await pos.waitForSelector('[data-testid="receipt"]');
const receipt = (await pos.locator('[data-testid="receipt"]').textContent()).replace(/\s+/g, " ");
check("struk tampil dengan nomor, item, dan total", /#\d+/.test(receipt) && receipt.includes(`Kopi ${run}`) && receipt.includes("Boba"), receipt.slice(0, 120));
await pos.screenshot({ path: `${out}/07-receipt.png` });
await pos.getByTestId("receipt-close").click();

// Simpan bill, buka lagi dari daftar, pisah
await pos.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).click();
await pos.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).click();
await pos.getByRole("button", { name: "Simpan", exact: true }).click();
await pos.waitForSelector("text=Bill disimpan");
await pos.getByRole("button", { name: "Pisah" }).click();
await pos.getByRole("dialog").getByRole("button", { name: "Tambah jumlah" }).first().click();
await pos.getByRole("button", { name: "Pisahkan" }).click();
await pos.waitForSelector("text=Bill dipisah");
check("pisah bill menghasilkan dua bill terbuka", true);
await pos.getByRole("button", { name: "Bill", exact: true }).click();
await pos.getByRole("dialog").locator("ul li button").first().waitFor();
const openCount = await pos.getByRole("dialog").locator("ul li button").count();
check("daftar bill terbuka berisi 2 bill", openCount === 2, `jumlah ${openCount}`);
await pos.screenshot({ path: `${out}/08-bills.png` });
await pos.keyboard.press("Escape");

// Shift: kas keluar, lalu tutup dengan selisih
await pos.getByRole("button", { name: "Shift", exact: true }).click();
await pos.getByRole("button", { name: "Kas keluar" }).click();
await pos.getByRole("dialog").getByLabel("Kas keluar").fill("5000");
await pos.getByRole("dialog").getByLabel("Keterangan").fill("beli es");
await pos.getByRole("button", { name: "Simpan", exact: true }).last().click();
await pos.waitForSelector("text=beli es");
await pos.screenshot({ path: `${out}/09-shift.png` });
await pos.getByRole("button", { name: "Tutup shift" }).first().click();
await pos.getByLabel("Uang tunai terhitung").fill("1");
await pos.getByRole("button", { name: "Tutup shift" }).last().click();
await pos.waitForSelector("text=Shift ditutup");
const closedText = (await pos.getByRole("dialog").textContent()).replace(/\s+/g, " ");
check("tutup shift menampilkan selisih negatif", /Selisih: -/.test(closedText), closedText.slice(-80));
await pos.getByRole("button", { name: "Selesai" }).click();
await pos.waitForSelector("text=Buka shift");
check("setelah tutup shift kembali ke layar buka shift", true);

// ---- RTL (Arab)
await pos.goto(`${base}/ar/pos`, { waitUntil: "networkidle" });
const dir = await pos.evaluate(() => document.documentElement.dir);
check("halaman kasir berbahasa Arab memakai arah RTL", dir === "rtl");
await pos.screenshot({ path: `${out}/10-rtl.png` });

// ---- pencabutan perangkat
await pos.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await pos.waitForSelector("text=Pilih nama Anda");
await bo.goto(`${base}/id/devices`, { waitUntil: "networkidle" });
await bo.locator("tr", { hasText: `Tablet ${run}` }).getByRole("button", { name: /Cabut/ }).click();
await bo.getByRole("dialog").getByRole("button", { name: "Cabut perangkat" }).click();
await bo.waitForSelector(`tr:has-text("Tablet ${run}") >> text=Dicabut`);
check("perangkat ditandai dicabut di Back Office", true);
await pos.reload({ waitUntil: "networkidle" });
await pos.waitForSelector("text=Aktifkan perangkat kasir", { timeout: 8000 }).catch(() => undefined);
check("perangkat yang dicabut dipaksa kembali ke layar aktivasi", await pos.getByText("Aktifkan perangkat kasir").isVisible());

await browser.close();
console.log(failures === 0 ? "\nSEMUA PEMERIKSAAN BROWSER LULUS" : `\n${failures} PEMERIKSAAN GAGAL`);
if (problems.length) console.log(["", "MASALAH BROWSER:", ...problems].join("\n"));
process.exit(failures ? 1 : 0);
