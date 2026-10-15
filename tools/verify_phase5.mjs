// Verifikasi browser Fase 5: bahan, resep, PO, stok, produksi, transfer, penyesuaian, ringkasan inventori, dan jalur kasir
// (stok terpotong, batas stok + konfirmasi, refund dengan kembali ke stok). Database harus BERSIH dan data demo ada.
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p5", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = "Rahasia123!";
const CASHIER_PIN = "482615";
const ADMIN_PIN = "739206";

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

// ---------------------------------------------------------------- data awal lewat API (katalog dan PIN)
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
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const pusat = outlets.find((o) => /Pusat/.test(o.name));
const cabang = outlets.find((o) => /Cabang/.test(o.name));
const employees = (await call("GET", "employees?pageSize=100")).items;
const uid = (email) => employees.find((e) => e.email === email).id;
await call("POST", `employees/${uid("kasir@naqdi.test")}/pin`, { pin: CASHIER_PIN });
await call("POST", `employees/${uid("admin@naqdi.test")}/pin`, { pin: ADMIN_PIN });
const airName = `Air ${run}`;
const kopiName = `Kopi ${run}`;
const bijiName = `Biji ${run}`;
const sirupName = `Sirup ${run}`;
const gulaName = `Gula ${run}`;
await call("POST", "items", { name: airName, trackStock: true, variants: [{ name: "R", basePrice: 5000, cost: 2000, sku: `AIR-${run}` }] });
await call("POST", "items", { name: kopiName, variants: [{ name: "R", basePrice: 30000, cost: 5000, sku: `KP-${run}` }] });
const gula = await call("POST", "ingredients", { name: gulaName, unit: "g" });
await call("POST", "ingredients", { name: sirupName, kind: "semi", unit: "ml", yieldQty: 1000, recipe: [{ componentId: gula.id, quantity: 600 }] });
const dev = await call("POST", "devices", { outletId: pusat.id, name: `Tablet ${run}` });

const browser = await chromium.launch();
let currentPage = null;
process.on("uncaughtException", async (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  try {
    await currentPage?.screenshot({ path: `${out}/gagal.png` });
  } catch {}
  process.exit(1);
});
const bo = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
watch(bo, "BO");
currentPage = bo;
await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await bo.fill('input[type="email"]', "admin@naqdi.test");
await bo.fill('input[type="password"]', PASSWORD);
await bo.click('button[type="submit"]');
await bo.waitForURL("**/id/dashboard");

const row = (page, text) => page.locator("tbody tr", { hasText: text }).first();
// Data dimuat setelah jeda singkat; ulangi sampai kondisi terpenuhi (maks. 8 dtk) sebelum menilai.
const until = async (fn) => {
  const end = Date.now() + 8000;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
};
const rowText = async (page, text) => ((await row(page, text).textContent()) ?? "").replace(/\s+/g, " ");

// ---------------------------------------------------------------- bahan (lewat form)
await bo.goto(`${base}/id/ingredients`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Tambah bahan" }).first().click();
await bo.getByLabel("Nama", { exact: true }).fill(bijiName);
await bo.getByLabel("Satuan", { exact: true }).fill("g");
await bo.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
await row(bo, bijiName).waitFor();
check("bahan mentah dibuat lewat form", true);
await row(bo, sirupName).waitFor();
check("bahan setengah jadi (dibuat lewat API) tampil dengan tombol produksi", (await row(bo, sirupName).getByRole("button", { name: /Produksi/ }).count()) === 1);

// ---------------------------------------------------------------- resep varian + stok modifier
await bo.goto(`${base}/id/recipes`, { waitUntil: "networkidle" });
await bo.getByPlaceholder("Cari").fill(kopiName);
await row(bo, kopiName).waitFor();
await row(bo, kopiName).getByRole("button", { name: /Ubah/ }).click();
await bo.getByRole("dialog").getByRole("button", { name: "Tambah bahan" }).click();
await bo.getByRole("dialog").getByLabel("Bahan", { exact: true }).selectOption({ label: `${bijiName} (g)` });
await bo.getByRole("dialog").getByLabel("Jumlah", { exact: true }).fill("18");
await bo.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
await bo.waitForSelector("text=Tersimpan");
check("resep varian tersimpan (18 g biji per kopi)", (await rowText(bo, kopiName)).includes("1 bahan"));
await bo.screenshot({ path: `${out}/01-recipes.png` });

// ---------------------------------------------------------------- pemasok + PO langsung diterima
await bo.goto(`${base}/id/suppliers`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Tambah pemasok" }).click();
await bo.getByLabel("Nama", { exact: true }).fill(`CV Maju ${run}`);
await bo.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
await row(bo, `CV Maju ${run}`).waitFor();
check("pemasok dibuat", true);

await bo.goto(`${base}/id/inventory/purchase-orders`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Buat PO" }).first().click();
await bo.getByRole("dialog").getByLabel("Outlet").selectOption({ label: pusat.name });
await bo.getByRole("dialog").getByLabel("Pemasok").selectOption({ label: `CV Maju ${run}` });
const addSubject = async (name) => {
  await bo.getByRole("dialog").getByLabel("Cari item atau bahan untuk ditambahkan").click();
  await bo.getByRole("dialog").getByLabel("Cari item atau bahan untuk ditambahkan").fill(name);
  await bo.getByRole("dialog").getByRole("option", { name: new RegExp(name) }).first().click();
};
await addSubject(bijiName);
await bo.getByLabel(`Jumlah ${bijiName}`).fill("5000");
await bo.getByLabel(`Biaya per satuan ${bijiName}`).fill("150");
await addSubject(gulaName);
await bo.getByLabel(`Jumlah ${gulaName}`).fill("10000");
await bo.getByLabel(`Biaya per satuan ${gulaName}`).fill("15");
await addSubject(airName);
await bo.getByLabel(`Jumlah ${airName}`).fill("100");
await bo.getByLabel(`Biaya per satuan ${airName}`).fill("2000");
await bo.getByLabel("Buat dan langsung terima semua").check();
await bo.screenshot({ path: `${out}/02-po-form.png` });
await bo.getByTestId("po-submit").click();
await bo.waitForSelector("text=Tersimpan");
check("PO dibuat dan langsung diterima (status Selesai)", /Selesai/.test(await rowText(bo, "#1")));

// ---------------------------------------------------------------- stok
const stockPage = async (outlet) => {
  await bo.goto(`${base}/id/inventory/stock`, { waitUntil: "networkidle" });
  await bo.getByLabel("Outlet").first().selectOption({ label: outlet });
  await bo.getByTestId("stock-table").locator("tbody tr").first().waitFor();
};
await stockPage(pusat.name);
const st1 = await until(async () => { const t = await rowText(bo, bijiName).catch(() => ""); return { ok: t.includes("5.000") && t.includes("750.000"), t }; });
check("stok biji = 5.000 g, nilai Rp 750.000", st1.ok, st1.t);
check("stok air terlacak = 100", (await rowText(bo, airName)).includes("100"));
await bo.screenshot({ path: `${out}/03-stock.png` });

// ---------------------------------------------------------------- produksi
await bo.goto(`${base}/id/ingredients`, { waitUntil: "networkidle" });
await row(bo, sirupName).getByRole("button", { name: /Produksi/ }).click();
await bo.getByRole("dialog").getByLabel("Outlet").selectOption({ label: pusat.name });
await bo.getByRole("dialog").getByLabel("Jumlah produksi (kali)").fill("2");
await bo.getByRole("dialog").getByRole("button", { name: "Produksi" }).last().click();
await bo.waitForSelector("text=Menghasilkan");
await stockPage(pusat.name);
const st2 = await until(async () => { const g = await rowText(bo, gulaName).catch(() => ""); const sy = await rowText(bo, sirupName).catch(() => ""); return { ok: g.includes("8.800") && sy.includes("2.000"), t: `${g} | ${sy}` }; });
check("produksi: gula berkurang 1.200 g (8.800) dan sirup 2.000 ml", st2.ok, st2.t);

// ---------------------------------------------------------------- penyesuaian
await bo.goto(`${base}/id/inventory/adjustments`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Buat penyesuaian" }).first().click();
await bo.getByRole("dialog").getByLabel("Outlet").selectOption({ label: pusat.name });
await bo.getByRole("dialog").getByLabel("Catatan").fill("opname uji");
await addSubject(gulaName);
await bo.getByLabel(`Hitungan aktual ${gulaName}`).fill("8700");
await bo.getByTestId("adjustment-submit").click();
await bo.waitForSelector("text=Tersimpan");
await bo.getByTestId("adjustment-table").locator("tbody tr").first().click();
const adj = ((await bo.getByRole("dialog").textContent()) ?? "").replace(/\s+/g, " ");
check("penyesuaian: selisih -100 g bernilai Rp 1.500 (100 x 15)", /-100/.test(adj) && adj.includes("1.500"), adj.slice(0, 160));
await bo.keyboard.press("Escape");

// ---------------------------------------------------------------- transfer
await bo.goto(`${base}/id/inventory/transfers`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Buat transfer" }).first().click();
await bo.getByRole("dialog").getByLabel("Dari outlet").selectOption({ label: pusat.name });
await bo.getByRole("dialog").getByLabel("Ke outlet").selectOption({ label: cabang.name });
await addSubject(bijiName);
await bo.getByLabel(`Jumlah ${bijiName}`).fill("1000");
await bo.getByTestId("transfer-submit").click();
await bo.waitForSelector("text=Transfer dikirim");
await bo.getByTestId("transfer-table").locator("tbody tr").first().getByRole("button", { name: /Lihat/ }).click();
await bo.getByLabel(`Diterima ${bijiName}`).fill("900");
await bo.getByTestId("transfer-receive").click();
await bo.waitForSelector("text=Transfer diterima");
await stockPage(cabang.name);
const st3 = await until(async () => { const t = await rowText(bo, bijiName).catch(() => ""); return { ok: t.includes("900") && t.includes("135.000"), t }; });
check("transfer: outlet tujuan menerima 900 g dengan biaya asal (Rp 135.000)", st3.ok, st3.t);
await stockPage(pusat.name);
const st4 = await until(async () => { const t = await rowText(bo, bijiName).catch(() => ""); return { ok: t.includes("4.000"), t }; });
check("transfer: outlet asal berkurang 1.000 g (4.000)", st4.ok, st4.t);

// ---------------------------------------------------------------- batas stok di form outlet
await bo.goto(`${base}/id/outlets`, { waitUntil: "networkidle" });
await row(bo, pusat.name).getByRole("button", { name: /Ubah/ }).click();
await bo.getByLabel("Batas stok saat menjual").selectOption("override");
await bo.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
await bo.waitForSelector("text=Tersimpan");
check("mode batas stok 'kasir boleh menjual tetap' tersimpan", (await call("GET", `outlets/${pusat.id}`)).stockMode === "override");

// ---------------------------------------------------------------- kasir
const pos = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
watch(pos, "POS");
currentPage = pos;
await pos.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await pos.getByLabel("Kode aktivasi").fill(dev.activationCode);
await pos.getByRole("button", { name: "Aktifkan" }).click();
await pos.waitForSelector("text=Pilih nama Anda");
const pressPin = async (pin) => {
  for (const d of pin) await pos.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
};
await pos.getByRole("button", { name: /Kasir/ }).first().click();
await pressPin(CASHIER_PIN);
await pos.getByRole("button", { name: "Masuk", exact: true }).click();
await pos.getByLabel("Uang di laci saat buka").fill("100000");
await pos.getByRole("button", { name: "Buka shift" }).click();
await pos.waitForSelector(`text=${airName}`);
check("kasir menampilkan sisa stok item terlacak", /Sisa 100/.test((await pos.getByTestId(`stock-${airName}`).textContent()) ?? ""));
await pos.screenshot({ path: `${out}/04-pos-stock.png` });

const catalog = pos.locator('section[aria-label="Katalog"]');
// 101 air dengan mode "override": ditahan, kasir boleh menjual tetap
const addAir = () => catalog.getByRole("button", { name: new RegExp(airName) }).click();
await addAir();
for (let i = 0; i < 100; i++) await pos.getByRole("button", { name: "Tambah jumlah" }).first().click();
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
await pos.getByRole("dialog").getByRole("textbox", { name: "Jumlah" }).first().fill("1000000");
await pos.getByTestId("confirm-pay").click();
await pos.getByTestId("stock-short").waitFor();
const shortText = ((await pos.getByTestId("stock-short").textContent()) ?? "").replace(/\s+/g, " ");
check("stok kurang: kasir diperingatkan (butuh 101, ada 100)", shortText.includes(airName) && /101/.test(shortText), shortText.slice(0, 140));
await pos.screenshot({ path: `${out}/05-stock-short.png` });
await pos.getByTestId("stock-override").click();
await pos.waitForSelector('[data-testid="receipt"]');
check("jual tetap menyelesaikan pembayaran", true);
await pos.getByTestId("receipt-close").click();
await call("GET", `inventory/stock?outletId=${pusat.id}&pageSize=100`).then((r) => check("stok air menjadi -1 setelah jual tetap", r.items.find((i) => i.name.startsWith(airName)).quantity === -1));

// refund dengan kembali ke stok
await pos.getByRole("button", { name: "Bill", exact: true }).click();
await pos.getByRole("tab", { name: "Sudah dibayar" }).click();
await pos.getByRole("dialog").locator("ul li button").first().click();
await pos.getByTestId("open-refund").click();
await pos.getByRole("dialog").getByRole("button", { name: "Pilih semua" }).click();
await pos.getByRole("dialog").getByLabel("Alasan").fill("salah beli");
await pos.getByRole("dialog").getByLabel("PIN atasan").fill(ADMIN_PIN);
await pos.getByTestId("refund-restock").check();
await pos.getByTestId("refund-confirm").click();
await pos.getByText(/Refund .* berhasil/).waitFor();
await call("GET", `inventory/stock?outletId=${pusat.id}&pageSize=100`).then((r) => check("refund dengan 'kembalikan ke stok': air kembali ke 100", r.items.find((i) => i.name.startsWith(airName)).quantity === 100, String(r.items.find((i) => i.name.startsWith(airName)).quantity)));

// ---------------------------------------------------------------- ringkasan inventori
await bo.goto(`${base}/id/reports/inventory`, { waitUntil: "networkidle" });
await bo.getByTestId("report-table").locator("tbody tr").first().waitFor();
const sum = ((await bo.getByTestId("report-table").textContent()) ?? "").replace(/\s+/g, " ");
check("ringkasan inventori memuat bahan dan item terlacak", sum.includes(bijiName) && sum.includes(airName) && sum.includes(sirupName));
await bo.screenshot({ path: `${out}/06-inventory-summary.png` });
await bo.goto(`${base}/ar/inventory/stock`, { waitUntil: "networkidle" });
check("halaman stok berbahasa Arab memakai RTL", (await bo.evaluate(() => document.documentElement.dir)) === "rtl");

await browser.close();
console.log(failures === 0 ? "\nSEMUA PEMERIKSAAN BROWSER LULUS" : `\n${failures} PEMERIKSAAN GAGAL`);
if (problems.length) console.log(["", "MASALAH BROWSER:", ...problems].join("\n"));
process.exit(failures ? 1 : 0);
