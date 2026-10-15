// Verifikasi browser Fase 7: peran dan hak akses (menu dan halaman terlindungi), checkout, desain struk dengan pratinjau, metode
// pembayaran, notifikasi, slot karyawan, dan efeknya di kasir. Database harus BERSIH dan data demo ada (Rahasia123!).
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p7", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = "Rahasia123!";
const CASHIER_PIN = "482615";

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

// ---------------------------------------------------------------- data awal
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
const itemName = `Kopi ${run}`;
await call("POST", "items", { name: itemName, variants: [{ name: "R", basePrice: 22000, sku: `K-${run}` }] });
const employees = (await call("GET", "employees?pageSize=100")).items;
await call("POST", `employees/${employees.find((e) => e.email === "kasir@naqdi.test").id}/pin`, { pin: CASHIER_PIN });
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
const login = async (page, email) => {
  await page.goto(`${base}/id/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/id/dashboard");
};
await login(bo, "admin@naqdi.test");
const row = (page, text) => page.locator("tbody tr", { hasText: text }).first();

// ---------------------------------------------------------------- peran (lewat form)
await bo.goto(`${base}/id/roles`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Buat peran" }).first().click();
await bo.getByRole("dialog").getByLabel("Nama", { exact: true }).fill("Hanya Laporan");
await bo.getByRole("dialog").getByLabel("Akses", { exact: true }).selectOption("backoffice_only");
await bo.getByTestId("priv-reports.view").check();
await bo.getByTestId("role-save").click();
await bo.getByRole("dialog").locator('[role="alert"]').waitFor();
check("peran akses Back Office tanpa hak backoffice.view ditolak dengan pesan", /backoffice\.view/.test((await bo.getByRole("dialog").locator('[role="alert"]').textContent()) ?? ""));
await bo.getByTestId("priv-backoffice.view").check();
await bo.getByTestId("role-save").click();
await bo.waitForSelector("text=Tersimpan");
await row(bo, "Hanya Laporan").waitFor();
const savedRole = (await call("GET", "roles")).items.find((r) => r.name === "Hanya Laporan");
check("peran kustom tersimpan dengan hak yang dipilih (backoffice.view dan reports.view)", savedRole?.privileges.includes("backoffice.view") && savedRole.privileges.includes("reports.view"), (await row(bo, "Hanya Laporan").textContent())?.replace(/\s+/g, " "));
await bo.getByRole("button", { name: /Lihat Administrator|Ubah Administrator/ }).first().click();
check("peran bawaan hanya bisa dilihat (kolom nama dan hak terkunci)", await bo.getByTestId("priv-settings.manage").isDisabled());
await bo.keyboard.press("Escape");
await bo.screenshot({ path: `${out}/01-roles.png` });

// karyawan dengan peran itu: menu dan halaman terlindungi
const roleId = (await call("GET", "roles")).items.find((r) => r.name === "Hanya Laporan").id;
await call("POST", "employees", { name: "Pelapor", email: `pelapor-${run}@uji.test`, password: PASSWORD, roleId, outletIds: [pusat.id], status: "active" });
const lim = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
watch(lim, "BO-terbatas");
await login(lim, `pelapor-${run}@uji.test`);
const nav = ((await lim.locator('nav[aria-label="Menu"]').textContent()) ?? "").replace(/\s+/g, " ");
check("menu karyawan terbatas: ada Laporan, tidak ada Pengaturan Akun, Hak Akses, Perangkat, Karyawan", /Laporan/.test(nav) && !/Pengaturan Akun/.test(nav) && !/Hak Akses/.test(nav) && !/Perangkat Kasir/.test(nav) && !/Karyawan/.test(nav), nav.slice(0, 160));
await lim.goto(`${base}/id/settings/checkout`, { waitUntil: "networkidle" });
check("membuka halaman pengaturan lewat URL ditolak dengan pesan", await lim.getByTestId("forbidden-page").isVisible());
await lim.goto(`${base}/id/employees`, { waitUntil: "networkidle" });
check("halaman karyawan juga ditolak", await lim.getByTestId("forbidden-page").isVisible());
await lim.goto(`${base}/id/reports/summary`, { waitUntil: "networkidle" });
await lim.getByTestId("summary").waitFor();
check("halaman laporan terbuka untuk peran yang berhak", true);
await lim.screenshot({ path: `${out}/02-limited.png` });

// ---------------------------------------------------------------- checkout
await bo.goto(`${base}/id/settings/checkout`, { waitUntil: "networkidle" });
await bo.getByTestId("checkout-gratuityEnabled").uncheck();
await bo.getByTestId("checkout-save").click();
await bo.waitForSelector("text=Tersimpan");
check("pengaturan checkout tersimpan (service charge dimatikan)", (await call("GET", "settings")).checkout.gratuityEnabled === false);

// ---------------------------------------------------------------- desain struk + pratinjau
await bo.goto(`${base}/id/settings/receipt`, { waitUntil: "networkidle" });
await bo.getByTestId("receipt-header").fill("Buka 08.00-22.00");
await bo.getByTestId("receipt-footer").fill("Sampai jumpa lagi");
await bo.getByTestId("receipt-paper").selectOption("58");
const preview = async () => ((await bo.getByTestId("receipt-preview").textContent()) ?? "").replace(/\s+/g, " ");
const p1 = await until(async () => { const t = await preview(); return { ok: t.includes("Buka 08.00-22.00") && t.includes("Sampai jumpa lagi"), t }; });
check("pratinjau struk langsung berubah (header dan catatan kaki)", p1.ok, p1.t.slice(0, 100));
check("lebar kertas 58 mm tercermin di pratinjau", (await bo.getByTestId("receipt-preview").locator("[data-paper]").getAttribute("data-paper")) === "58");
await bo.getByTestId("receipt-showTaxBreakdown").uncheck();
const p2 = await until(async () => { const t = await preview(); return { ok: /Pajak dan service/.test(t) && !/PB1 10%/.test(t), t }; });
check("tanpa rincian pajak: pratinjau menggabungkan pajak dan service jadi satu baris", p2.ok);
await bo.screenshot({ path: `${out}/03-receipt-designer.png` });
await bo.getByTestId("receipt-save").click();
await bo.waitForSelector("text=Tersimpan");

// ---------------------------------------------------------------- metode pembayaran
await bo.goto(`${base}/id/settings/payments`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Tambah metode" }).first().click();
await bo.getByRole("dialog").getByLabel("Nama", { exact: true }).fill("GoPay");
await bo.getByTestId("method-create").click();
await row(bo, "GoPay").waitFor();
check("metode kustom GoPay ditambahkan", true);
const cashBox = row(bo, "Tunai").getByRole("checkbox").first();
check("metode tunai tidak bisa dimatikan", await cashBox.isDisabled());
await row(bo, "Kartu").getByRole("checkbox").click(); // kotak terkendali: status berubah setelah server menjawab
await until(async () => ({ ok: (await call("GET", "settings")).paymentMethods.find((m) => m.key === "card").enabled === false }));
check("metode Kartu dimatikan", (await call("GET", "settings")).paymentMethods.find((m) => m.key === "card").enabled === false);
await bo.screenshot({ path: `${out}/04-payments.png` });

// ---------------------------------------------------------------- notifikasi
await bo.goto(`${base}/id/settings/notifications`, { waitUntil: "networkidle" });
check("pemberitahuan jelas: pengiriman email belum tersedia", await bo.getByTestId("email-notice").isVisible());
await bo.getByTestId("notif-daily").check();
await bo.getByTestId("notif-recipients").fill("owner@toko.test\ngm@toko.test");
await bo.getByTestId("notif-save").click();
await bo.waitForSelector("text=Tersimpan");
await bo.getByTestId("notif-test").click();
await bo.getByTestId("notif-preview").waitFor();
check("pesan contoh dibuat dan ditandai belum terkirim", /Transaksi:/.test((await bo.getByTestId("notif-preview").textContent()) ?? "") && /belum dikirim/i.test((await bo.getByTestId("notif-preview").textContent()) ?? ""));

// ---------------------------------------------------------------- slot karyawan
await bo.goto(`${base}/id/settings/account`, { waitUntil: "networkidle" });
const used = await until(async () => { const t = ((await bo.getByTestId("slots-used").textContent()) ?? "").trim(); return { ok: /^\d+$/.test(t), t }; });
await bo.getByTestId("slots-input").fill(used.t);
await bo.getByTestId("account-save").click();
await bo.waitForSelector("text=Tersimpan");
let slotRes = 0;
try {
  await call("POST", "employees", { name: "Kelebihan", email: `lebih-${run}@uji.test`, password: PASSWORD, roleId, outletIds: [pusat.id], status: "active" });
} catch (e) {
  slotRes = /409/.test(String(e)) ? 409 : 0;
}
check("slot penuh: karyawan aktif baru ditolak (409)", slotRes === 409);
await call("PUT", "settings/account", { employeeSlots: null });

// ---------------------------------------------------------------- kasir mengikuti pengaturan
const pos = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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
await pos.locator('section[aria-label="Katalog"]').getByRole("button", { name: new RegExp(itemName) }).click();
const cart1 = await until(async () => { const t = ((await pos.locator("aside").textContent()) ?? "").replace(/\s+/g, " "); return { ok: /PB1/.test(t), t }; });
check("service charge yang dimatikan tidak muncul di keranjang (hanya pajak)", cart1.ok && !/Service/i.test(cart1.t), cart1.t.slice(0, 160));
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
const options = await pos.getByRole("dialog").getByLabel("Metode").first().locator("option").allTextContents();
check("daftar metode di kasir: ada GoPay, tidak ada Kartu", options.includes("GoPay") && !options.includes("Kartu"), options.join(","));
await pos.getByRole("dialog").getByLabel("Metode").first().selectOption({ label: "GoPay" });
await pos.getByRole("dialog").getByRole("button", { name: "Pas" }).click();
await pos.getByTestId("confirm-pay").click();
await pos.waitForSelector('[data-testid="receipt"]');
const rc = ((await pos.getByTestId("receipt").textContent()) ?? "").replace(/\s+/g, " ");
check("struk mengikuti desain: header, catatan kaki, metode GoPay, pajak digabung", rc.includes("Buka 08.00-22.00") && rc.includes("Sampai jumpa lagi") && rc.includes("GoPay") && /Pajak dan service/.test(rc), rc.slice(0, 140));
check("lebar kertas struk 58 mm", (await pos.getByTestId("receipt").getAttribute("data-paper")) === "58");
await pos.screenshot({ path: `${out}/05-pos-receipt.png` });

await bo.goto(`${base}/ar/settings/receipt`, { waitUntil: "networkidle" });
await bo.getByTestId("receipt-preview").waitFor();
check("halaman desain struk berbahasa Arab memakai RTL", (await bo.evaluate(() => document.documentElement.dir)) === "rtl");

await browser.close();
console.log(failures === 0 ? "\nSEMUA PEMERIKSAAN BROWSER LULUS" : `\n${failures} PEMERIKSAAN GAGAL`);
if (problems.length) console.log(["", "MASALAH BROWSER:", ...problems].join("\n"));
process.exit(failures ? 1 : 0);
