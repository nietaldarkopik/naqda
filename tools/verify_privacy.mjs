// Verifikasi browser privasi pelanggan dan nomor pajak di struk: NPWP di pratinjau dan struk kasir; persetujuan wajib (Back Office
// dan kasir); unduh data pelanggan; hapus data pribadi (nama hilang dari daftar, pencarian, dan snapshot struk); dialog retensi.
// Prasyarat sama seperti verify_phase8.mjs (API + web PRODUKSI berjalan, data demo). Mengubah data demo (item, perangkat, pelanggan, struk).
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3000";
const apiBase = process.env.API ?? "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-privacy", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const L = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../packages/i18n/src/messages/id.json", import.meta.url)), "utf8"));
const PASSWORD = process.env.DEMO_PASSWORD ?? "Naqdi123!";
const PIN = "482615";
const TAX = "01.234.567.8-901.000";
const run = Date.now().toString(36).slice(-4);
const NAME = `Siti Uji ${run}`;
const PHONE = `0899${Date.now().toString().slice(-7)}`;

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const norm = (s) => s.replace(/\s+/g, " ").trim();

const api = await pwRequest.newContext({ baseURL: apiBase });
const token = (await (await api.post("auth/login", { data: { email: "admin@naqdi.test", password: PASSWORD } })).json()).accessToken;
const H = { authorization: `Bearer ${token}` };
const call = async (method, path, data) => {
  const res = await api.fetch(path, { method, data, headers: H });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
};
await call("POST", "items", { name: `Roti ${run}`, variants: [{ name: "R", basePrice: 15000 }] });
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const employees = (await call("GET", "employees?pageSize=100")).items;
await call("POST", `employees/${employees.find((e) => e.email === "kasir@naqdi.test").id}/pin`, { pin: PIN });
const dev = await call("POST", "devices", { outletId: (outlets.find((o) => /Pusat/.test(o.name)) ?? outlets[0]).id, name: `Priv ${run}` });

const browser = await chromium.launch();
const problems = [];
const bo = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })).newPage();
bo.on("pageerror", (e) => problems.push(`BO: ${e.message}`));
await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await bo.fill('input[type="email"]', "admin@naqdi.test");
await bo.fill('input[type="password"]', PASSWORD);
await bo.click('button[type="submit"]');
await bo.waitForURL(/dashboard/);

// ================================================================ nomor pajak di struk
await bo.goto(`${base}/id/settings/receipt`, { waitUntil: "networkidle" });
await bo.getByTestId("receipt-taxid-label").fill("NPWP");
await bo.getByTestId("receipt-taxid-input").fill(TAX);
const preview = norm(await bo.getByTestId("receipt").textContent());
check("pratinjau struk menampilkan NPWP", preview.includes(`NPWP: ${TAX}`), preview.slice(0, 80));
await bo.getByRole("button", { name: L.common.save, exact: true }).first().click();
await bo.getByText(L.common.saved).first().waitFor({ timeout: 5000 }).catch(() => undefined);
await bo.screenshot({ path: `${out}/1-receipt-settings.png` });

// ================================================================ persetujuan di Back Office
await bo.goto(`${base}/id/customers`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: L.customers.create }).click();
const form = bo.locator("#customer-form");
await form.locator("input").first().fill(`Tanpa Setuju ${run}`);
await form.getByLabel(L.common.phone).fill("0811000999");
check("kotak persetujuan muncul begitu telepon diisi", await bo.getByTestId("customer-consent").isVisible());
await bo.locator("button[form=customer-form]").click();
await bo.getByText(L.customers.consentRequired).first().waitFor({ timeout: 5000 }).then(
  () => check("simpan tanpa persetujuan ditolak dengan pesan", true),
  () => check("simpan tanpa persetujuan ditolak dengan pesan", false),
);
await bo.getByRole("button", { name: L.common.cancel }).first().click();

// ================================================================ kasir: pelanggan baru dengan persetujuan, struk dengan NPWP
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const pos = await ctx.newPage();
pos.on("pageerror", (e) => problems.push(`POS: ${e.message}`));
await pos.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await pos.getByLabel("Kode aktivasi").fill(dev.activationCode);
await pos.getByRole("button", { name: "Aktifkan" }).click();
await pos.getByRole("button", { name: /Kasir/ }).first().click();
for (const d of PIN) await pos.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
await pos.getByRole("button", { name: "Masuk", exact: true }).click();
await pos.getByLabel("Uang di laci saat buka").or(pos.getByTestId("cart-total")).first().waitFor();
if (await pos.getByLabel("Uang di laci saat buka").isVisible()) {
  await pos.getByLabel("Uang di laci saat buka").fill("100000");
  await pos.getByRole("button", { name: "Buka shift" }).click();
}
await pos.getByRole("button", { name: new RegExp(`Roti ${run}`) }).first().click();
await pos.getByTestId("open-customer").click();
await pos.getByRole("button", { name: L.cashier.newCustomer }).click();
await pos.getByLabel(L.cashier.customerName).fill(NAME);
await pos.getByLabel(L.cashier.customerPhone).fill(PHONE);
check("kasir: tombol simpan nonaktif sampai persetujuan dicentang", await pos.getByTestId("customer-create").isDisabled());
await pos.getByTestId("customer-consent").check();
check("kasir: setelah dicentang tombol aktif", await pos.getByTestId("customer-create").isEnabled());
await pos.screenshot({ path: `${out}/2-pos-consent.png` });
await pos.getByTestId("customer-create").click();
await pos.getByTestId("cart-total").waitFor();
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.getByRole("dialog").getByRole("button", { name: "Pas" }).first().click();
await pos.getByTestId("confirm-pay").click();
await pos.getByTestId("receipt").waitFor();
const receipt = norm(await pos.getByTestId("receipt").textContent());
check("struk kasir memuat NPWP", receipt.includes(`NPWP: ${TAX}`));
check("struk memuat nama pelanggan sebelum dihapus", receipt.includes(NAME));
await pos.screenshot({ path: `${out}/3-pos-receipt.png` });
await ctx.close();

// ================================================================ unduh dan hapus data
await bo.goto(`${base}/id/customers`, { waitUntil: "networkidle" });
await bo.getByPlaceholder(/Cari/).first().fill(PHONE);
await bo.getByRole("button", { name: new RegExp(`${L.customers.history} ${NAME}`) }).waitFor({ timeout: 8000 });
await bo.getByRole("button", { name: new RegExp(`${L.customers.history} ${NAME}`) }).click();
const panel = bo.getByTestId("privacy-panel");
await panel.waitFor();
check("panel privasi menampilkan tanggal persetujuan", /Persetujuan data pribadi: \d/.test(norm(await panel.textContent())));
const [download] = await Promise.all([bo.waitForEvent("download"), bo.getByTestId("download-data").click()]);
const data = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
check("unduhan JSON memuat profil, persetujuan, dan transaksi", data.customer.name === NAME && data.customer.phone === PHONE && Boolean(data.customer.consentAt) && data.orders.length === 1, download.suggestedFilename());
await bo.screenshot({ path: `${out}/4-detail-privacy.png` });
await bo.getByTestId("erase-data").click();
await bo.getByTestId("erase-confirm").waitFor();
await bo.screenshot({ path: `${out}/5-erase-confirm.png` });
await bo.getByTestId("erase-confirm").click();
await bo.getByText(L.customers.privacy.erased).first().waitFor({ timeout: 8000 });
check("hapus data pribadi berhasil", true);
await bo.getByPlaceholder(/Cari/).first().fill(PHONE);
await bo.waitForTimeout(700);
check("pelanggan tidak lagi muncul di pencarian", (await bo.getByText(NAME).count()) === 0);

// bukti di API: snapshot struk dan pelanggan
const rows = (await call("GET", `reports/transactions?pageSize=50`)).items ?? [];
const txt = JSON.stringify(rows);
check("laporan transaksi tidak memuat nama pelanggan lagi", !txt.includes(NAME));

// ================================================================ retensi
await bo.goto(`${base}/id/customers`, { waitUntil: "networkidle" });
await bo.getByTestId("open-retention").click();
await bo.getByTestId("retention-months").fill("240");
await bo.getByTestId("retention-check").click();
await bo.getByTestId("retention-result").waitFor({ timeout: 8000 });
check("dialog retensi menampilkan hasil pemeriksaan (tanpa menghapus apa pun)", /pelanggan memenuhi syarat/.test(norm(await bo.getByTestId("retention-result").textContent())));
await bo.screenshot({ path: `${out}/6-retention.png` });

check("tanpa galat halaman", problems.length === 0, problems.slice(0, 2).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
process.exit(failures === 0 ? 0 : 1);
