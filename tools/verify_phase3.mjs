// Verifikasi browser Fase 3: meja (denah Back Office + pilih meja di kasir), persetujuan atasan, refund, aktivitas.
// Prasyarat: API di :4000 dan web di :3000 dengan data demo (kata sandi Rahasia123!). Jalankan pada database yang bersih.
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p3", import.meta.url));
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

// ---- data awal lewat API
const api = await pwRequest.newContext({ baseURL: apiBase });
const token = (await (await api.post("auth/login", { data: { email: "admin@naqdi.test", password: PASSWORD } })).json()).accessToken;
const H = { authorization: `Bearer ${token}` };
const send = async (method, path, data) => {
  const res = await api.fetch(path, { method, data, headers: H });
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
};
const run = Date.now().toString(36).slice(-4);
const outlets = (await send("GET", "outlets?pageSize=100")).items;
const pusat = outlets.find((o) => /Pusat/.test(o.name));
await send("POST", "taxes", { name: `PPN ${run}`, rateBp: 1100, allOutlets: true });
const itemName = `Kopi ${run}`;
await send("POST", "items", { name: itemName, variants: [{ name: "R", basePrice: 20000, sku: `K-${run}` }] });
const employees = (await send("GET", "employees?pageSize=100")).items;
const idOfEmail = (email) => employees.find((e) => e.email === email).id;
await send("POST", `employees/${idOfEmail("kasir@naqdi.test")}/pin`, { pin: CASHIER_PIN });
await send("POST", `employees/${idOfEmail("admin@naqdi.test")}/pin`, { pin: ADMIN_PIN });
const dev = await send("POST", "devices", { outletId: pusat.id, name: `Tablet ${run}` });

const browser = await chromium.launch();
let currentPage = null;
process.on("uncaughtException", async (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  try {
    await currentPage?.screenshot({ path: `${out}/gagal.png` });
  } catch {}
  process.exit(1);
});

// ============================================================ Back Office: denah meja
const bo = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
watch(bo, "BO");
currentPage = bo;
await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await bo.fill('input[type="email"]', "admin@naqdi.test");
await bo.fill('input[type="password"]', PASSWORD);
await bo.click('button[type="submit"]');
await bo.waitForURL("**/id/dashboard");
await bo.goto(`${base}/id/tables`, { waitUntil: "networkidle" });
await bo.getByLabel("Outlet").first().selectOption({ label: pusat.name });

await bo.getByLabel("Nama grup").fill("Indoor");
await bo.getByRole("button", { name: "Tambah", exact: true }).click();
await bo.waitForSelector("li:has-text('Indoor')");
for (const name of ["Meja 1", "Meja 2"]) {
  await bo.getByRole("button", { name: "Tambah meja" }).click();
  await bo.getByLabel("Nama", { exact: true }).fill(name);
  await bo.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
  await bo.waitForSelector(`[data-testid="table-${name}"]`);
}
check("meja ditambah lewat form dan muncul di denah", true);

const t1 = bo.getByTestId("table-Meja 1");
const before = await t1.boundingBox();
await t1.hover();
await bo.mouse.down();
await bo.mouse.move(before.x + 300, before.y + 140, { steps: 10 });
await bo.mouse.up();
const after = await t1.boundingBox();
check("meja bisa digeser di denah", Math.abs(after.x - before.x) > 200 && Math.abs(after.y - before.y) > 100);
await bo.getByRole("button", { name: "Simpan tata letak" }).click();
await bo.waitForSelector("text=Tersimpan");
const saved = (await send("GET", `tables?outletId=${pusat.id}`)).items.find((t) => t.name === "Meja 1");
check("posisi baru tersimpan di server (kolom/baris berubah)", saved.x > 3 || saved.y > 1, `x=${saved.x} y=${saved.y}`);
await bo.screenshot({ path: `${out}/01-floor-editor.png` });

// ============================================================ Kasir
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
await pos.waitForSelector(`text=${itemName}`);

// Pilih meja dari denah
await pos.getByTestId("open-tables").click();
await pos.waitForSelector('[data-testid="pos-floor"]');
check("denah meja kasir menampilkan meja yang dibuat di Back Office", (await pos.getByTestId("pos-table-Meja 1").isVisible()) && (await pos.getByTestId("pos-table-Meja 2").isVisible()));
await pos.screenshot({ path: `${out}/02-pos-floor.png` });
await pos.getByTestId("pos-table-Meja 1").click();
check("meja terpilih tampil di keranjang", await pos.getByTestId("open-tables").getByText("Meja 1").isVisible());

const addKopi = () => pos.locator('section[aria-label="Katalog"]').getByRole("button", { name: new RegExp(itemName) }).click();
await addKopi();
await addKopi();
await addKopi();
await pos.getByRole("button", { name: "Simpan", exact: true }).click();
await pos.waitForSelector("text=Bill disimpan");

// Mengurangi item pada bill tersimpan -> butuh atasan
await pos.getByRole("button", { name: "Kurangi jumlah" }).first().click();
await pos.getByRole("button", { name: "Simpan", exact: true }).click();
await pos.waitForSelector('[data-testid="approval-confirm"]');
check("mengurangi item tersimpan memunculkan dialog persetujuan atasan", true);
await pos.screenshot({ path: `${out}/03-approval.png` });
const dlg = pos.getByRole("dialog");
await dlg.getByLabel("Alasan").fill("pelanggan batal 1");
await dlg.getByLabel("PIN atasan").fill("000999");
await pos.getByTestId("approval-confirm").click();
await dlg.locator('p[role="alert"]').waitFor();
check("PIN atasan salah ditolak, dialog tetap terbuka, kasir tidak keluar", (await dlg.locator('p[role="alert"]').isVisible()) && (await pos.getByTestId("approval-confirm").isVisible()));
await dlg.getByLabel("PIN atasan").fill(ADMIN_PIN);
await pos.getByTestId("approval-confirm").click();
await pos.getByTestId("approval-confirm").waitFor({ state: "detached" });
check("PIN atasan benar menyimpan perubahan", true);

// Tambah lagi jadi 3 dan bayar tunai
await addKopi();
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
await pos.locator("div[role=dialog] button", { hasText: /Rp\s?100\.000/ }).first().click();
await pos.getByTestId("confirm-pay").click();
await pos.waitForSelector('[data-testid="receipt"]');
const paidTotalText = (await pos.getByTestId("receipt").textContent()) ?? "";
check("pembayaran bill meja berhasil dan struk tampil", /#\d+/.test(paidTotalText));
await pos.getByTestId("receipt-close").click();

// Meja bebas lagi setelah dibayar
await pos.getByTestId("open-tables").click();
await pos.waitForSelector('[data-testid="pos-floor"]');
const cls = await pos.getByTestId("pos-table-Meja 1").getAttribute("class");
check("meja kembali kosong (hijau) setelah bill dibayar", !/amber/.test(cls ?? ""));
await pos.keyboard.press("Escape");

// Refund dari daftar bill
await pos.getByRole("button", { name: "Bill", exact: true }).click();
await pos.getByRole("tab", { name: "Sudah dibayar" }).click();
await pos.getByRole("dialog").locator("ul li button").first().click();
await pos.getByTestId("open-refund").click();
await pos.getByRole("dialog").getByRole("button", { name: "Tambah jumlah" }).first().click();
const confirmText = (await pos.getByTestId("refund-confirm").textContent()) ?? "";
check("perkiraan refund 1 dari 3 tampil di tombol", /Rp\s?\d/.test(confirmText) && !/Rp\s?0$/.test(confirmText.trim()), confirmText.trim());
await pos.getByRole("dialog").getByLabel("Alasan").fill("salah menu");
await pos.getByRole("dialog").getByLabel("PIN atasan").fill(ADMIN_PIN);
await pos.screenshot({ path: `${out}/04-refund.png` });
await pos.getByTestId("refund-confirm").click();
await pos.waitForSelector("text=berhasil");
await pos.getByTestId("receipt").getByText("Di-refund").waitFor();
const receiptAfter = ((await pos.getByTestId("receipt").textContent()) ?? "").replace(/\s+/g, " ");
check("struk menampilkan jumlah yang sudah di-refund", /Di-refund/.test(receiptAfter), receiptAfter.slice(-90));
await pos.getByTestId("receipt-close").click();

// Shift memuat refund tunai
await pos.getByRole("button", { name: "Shift", exact: true }).click();
await pos.getByRole("dialog").getByText("Refund tunai").waitFor();
check("ringkasan shift memuat baris refund tunai", true);
await pos.screenshot({ path: `${out}/05-shift-refund.png` });
await pos.keyboard.press("Escape");

// Batalkan bill tersimpan (butuh atasan)
await pos.getByTestId("open-tables").click();
await pos.getByTestId("pos-table-Meja 2").click();
await addKopi();
await pos.getByRole("button", { name: "Simpan", exact: true }).click();
await pos.waitForSelector("text=Bill disimpan");
await pos.getByRole("button", { name: "Batalkan bill" }).click();
await pos.getByRole("dialog").getByLabel("Alasan").fill("tamu pergi");
await pos.getByRole("dialog").getByLabel("PIN atasan").fill(ADMIN_PIN);
await pos.getByTestId("approval-confirm").click();
await pos.waitForSelector("text=Bill dibatalkan");
check("pembatalan bill tersimpan lewat persetujuan atasan", true);

// ============================================================ Back Office: aktivitas
await bo.goto(`${base}/id/activities`, { waitUntil: "networkidle" });
await bo.waitForSelector("tbody tr");
const rows = (await bo.locator("tbody").textContent()).replace(/\s+/g, " ");
check("halaman aktivitas memuat refund, item dihapus, dan bill dibatalkan lengkap dengan penyetuju", /Refund/.test(rows) && /Item dihapus/.test(rows) && /Bill dibatalkan/.test(rows) && /Admin Demo/.test(rows));
await bo.screenshot({ path: `${out}/06-activities.png` });

// RTL
await pos.goto(`${base}/ar/pos`, { waitUntil: "networkidle" });
check("kasir berbahasa Arab memakai RTL", (await pos.evaluate(() => document.documentElement.dir)) === "rtl");
await bo.goto(`${base}/ar/tables`, { waitUntil: "networkidle" });
await bo.waitForSelector('[data-testid="floor"]');
await bo.screenshot({ path: `${out}/07-floor-rtl.png` });

await browser.close();
console.log(failures === 0 ? "\nSEMUA PEMERIKSAAN BROWSER LULUS" : `\n${failures} PEMERIKSAAN GAGAL`);
if (problems.length) console.log(["", "MASALAH BROWSER:", ...problems].join("\n"));
process.exit(failures ? 1 : 0);
