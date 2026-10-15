// Verifikasi browser Fase 6: pengaturan program loyalty, reward, pelanggan, poin saat bayar, tukar reward (termasuk kode validasi),
// feedback dan balasan, ekspor pelanggan, RTL. Database harus BERSIH dan data demo ada (Rahasia123!).
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p6", import.meta.url));
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

// ---------------------------------------------------------------- data awal lewat API
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
const uid = (email) => employees.find((e) => e.email === email).id;
await call("POST", `employees/${uid("kasir@naqdi.test")}/pin`, { pin: CASHIER_PIN });
await call("POST", `employees/${uid("admin@naqdi.test")}/pin`, { pin: ADMIN_PIN });
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
const bo = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
watch(bo, "BO");
currentPage = bo;
await bo.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await bo.fill('input[type="email"]', "admin@naqdi.test");
await bo.fill('input[type="password"]', PASSWORD);
await bo.click('button[type="submit"]');
await bo.waitForURL("**/id/dashboard");
const row = (page, text) => page.locator("tbody tr", { hasText: text }).first();
const rowText = async (page, text) => ((await row(page, text).textContent()) ?? "").replace(/\s+/g, " ");

// ---------------------------------------------------------------- program loyalty + reward (lewat form)
await bo.goto(`${base}/id/loyalty`, { waitUntil: "networkidle" });
await bo.getByTestId("loyalty-enabled").check();
await bo.getByLabel("Poin bonus member baru").fill("5");
await bo.getByTestId("loyalty-save").click();
await bo.waitForSelector("text=Tersimpan");
check("program loyalty diaktifkan lewat form (dasar: Rp 10.000 = 1 poin, bonus 5)", (await call("GET", "loyalty/program")).enabled === true);

await bo.getByRole("button", { name: "Tambah reward" }).click();
await bo.getByRole("dialog").getByLabel("Nama", { exact: true }).fill("Diskon 10%");
await bo.getByRole("dialog").getByLabel("Poin yang dipakai").fill("10");
await bo.getByRole("dialog").getByLabel("Persen potongan").fill("10");
await bo.getByRole("dialog").getByLabel("Potongan maksimum").fill("5000");
await bo.getByTestId("reward-save").click();
await bo.waitForSelector("text=Tersimpan");
await row(bo, "Diskon 10%").waitFor();
check("reward dibuat lewat form dan tampil di daftar", (await rowText(bo, "Diskon 10%")).includes("10%"));
await bo.screenshot({ path: `${out}/01-loyalty.png`, fullPage: true });

// ---------------------------------------------------------------- pelanggan (lewat form)
await bo.goto(`${base}/id/customers`, { waitUntil: "networkidle" });
await bo.getByRole("button", { name: "Tambah pelanggan" }).first().click();
await bo.getByRole("dialog").getByLabel("Nama", { exact: true }).fill("Andi Uji");
await bo.getByRole("dialog").getByLabel("Telepon").fill(`08${run}`);
await bo.getByRole("dialog").getByLabel("Daftarkan sebagai member loyalty").check();
await bo.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
await row(bo, "Andi Uji").waitFor();
const t1 = await until(async () => {
  const t = await rowText(bo, "Andi Uji");
  const c = (await call("GET", "customers?q=Andi")).items[0];
  return { ok: /Member/.test(t) && c?.points === 5 && c?.member === true, t };
});
check("pelanggan baru terdaftar sebagai member dan mendapat bonus 5 poin", t1.ok, t1.t);
check("kartu ringkasan: 1 member", (await bo.getByTestId("sum-members").textContent())?.trim() === "1");

// ---------------------------------------------------------------- kasir
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
const catalog = pos.locator('section[aria-label="Katalog"]');
const addKopi = () => catalog.getByRole("button", { name: new RegExp(itemName) }).click();

// pelanggan baru dari kasir (non-member -> daftarkan lewat kasir)
await pos.getByTestId("open-customer").click();
await pos.getByTestId("customer-new").click();
await pos.getByRole("dialog").getByLabel("Nama", { exact: true }).fill("Budi Kasir");
await pos.getByTestId("customer-enroll").uncheck();
await pos.getByTestId("customer-create").click();
const created = await until(async () => ({ ok: /Budi Kasir/.test((await pos.getByTestId("open-customer").textContent()) ?? "") }));
check("pelanggan baru dibuat dari kasir dan langsung terpilih", created.ok);
await pos.getByTestId("open-customer").click();
await pos.getByLabel("Cari nama, telepon, atau email").fill("Andi");
await pos.getByRole("dialog").getByRole("button", { name: /Andi Uji/ }).click();
check("member terpilih dan saldo poin tampil (5 poin)", /5 poin/.test((await pos.getByTestId("open-customer").textContent()) ?? ""));

await addKopi();
await addKopi();
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
await pos.getByRole("dialog").getByRole("textbox", { name: "Jumlah" }).first().fill("200000");
await pos.getByTestId("confirm-pay").click();
await pos.waitForSelector('[data-testid="receipt-loyalty"]');
const loyalText = ((await pos.getByTestId("receipt-loyalty").textContent()) ?? "").replace(/\s+/g, " ");
// 2 x 22.000 = 44.000 bersih -> 4 poin; saldo 5 + 4 = 9
check("struk menampilkan poin didapat +4 dan saldo 9", /\+4/.test(loyalText) && /9/.test(loyalText) && loyalText.includes("Andi Uji"), loyalText);
await pos.getByTestId("feedback-good").click();
await pos.getByTestId("feedback-done").waitFor();
check("feedback baik dikirim dari struk", true);
await pos.getByTestId("receipt-close").click();

// tukar reward dengan saldo cukup (tambah poin dari Back Office dulu)
const andiId = (await call("GET", `customers?q=Andi`)).items[0].id;
await call("POST", `customers/${andiId}/points`, { points: 10, note: "uji" });
await pos.getByTestId("open-customer").click();
await pos.getByLabel("Cari nama, telepon, atau email").fill("Andi");
await pos.getByRole("dialog").getByRole("button", { name: /Andi Uji/ }).click();
check("saldo poin diperbarui di pilihan pelanggan (19 poin)", /19 poin/.test((await pos.getByTestId("open-customer").textContent()) ?? ""));
await addKopi();
await addKopi();
await pos.getByTestId("open-reward").click();
await pos.getByTestId("reward-Diskon 10%").click();
const priced = await until(async () => { const t = ((await pos.getByTestId("cart-total").textContent()) ?? "").replace(/\D/g, ""); return { ok: t === "45738", t }; });
// dine in (data demo: service 5%, PB1 10%): 44.000 - 4.400 = 39.600; service 1.980; PB1 10% x 41.580 = 4.158 -> 45.738
check("keranjang dengan reward 10%: total Rp 45.738 (dihitung server)", priced.ok, `total ${priced.t}`);
await pos.screenshot({ path: `${out}/02-pos-reward.png` });
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
await pos.getByRole("dialog").getByRole("textbox", { name: "Jumlah" }).first().fill("100000");
await pos.getByTestId("confirm-pay").click();
await pos.waitForSelector('[data-testid="receipt-loyalty"]');
const loyal2 = ((await pos.getByTestId("receipt-loyalty").textContent()) ?? "").replace(/\s+/g, " ");
// poin: 19 - 10 + (net 39.600 -> 3) = 12
check("struk: -10 poin ditukar, +3 didapat, saldo 12", /-10/.test(loyal2) && /\+3/.test(loyal2) && /12/.test(loyal2), loyal2);
await pos.getByTestId("feedback-bad").click();
await pos.getByTestId("feedback-done").waitFor();
await pos.getByTestId("receipt-close").click();
check("saldo di Back Office cocok (12)", (await call("GET", `customers/${andiId}`)).points === 12);

// kode validasi
await bo.goto(`${base}/id/loyalty`, { waitUntil: "networkidle" });
await bo.getByLabel("Penukaran reward butuh kode validasi").check();
await bo.getByTestId("loyalty-save").click();
await bo.waitForSelector("text=Tersimpan");
await call("POST", `customers/${andiId}/points`, { points: 20, note: "uji kode" });
await pos.reload({ waitUntil: "networkidle" });
await pos.waitForSelector("text=Pilih nama Anda");
await pos.getByRole("button", { name: /Kasir/ }).first().click();
await pressPin(CASHIER_PIN);
await pos.getByRole("button", { name: "Masuk", exact: true }).click();
await pos.waitForSelector(`text=${itemName}`);
await pos.getByTestId("open-customer").click();
await pos.getByLabel("Cari nama, telepon, atau email").fill("Andi");
await pos.getByRole("dialog").getByRole("button", { name: /Andi Uji/ }).click();
await addKopi();
await addKopi();
await pos.getByTestId("open-reward").click();
await pos.getByTestId("reward-Diskon 10%").click();
await pos.getByTestId("dev-code").waitFor();
const devCode = ((await pos.getByTestId("dev-code").textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
check("reward butuh kode: kode dikirim (mode pengembangan menampilkannya)", /^\d{6}$/.test(devCode), devCode);
await pos.getByLabel("Kode validasi").fill(devCode);
await pos.getByTestId("reward-code-ok").click();
await pos.getByRole("button", { name: "Bayar", exact: true }).click();
await pos.waitForSelector('[data-testid="amount-due"]');
await pos.getByRole("dialog").getByRole("textbox", { name: "Jumlah" }).first().fill("100000");
await pos.getByTestId("confirm-pay").click();
await pos.waitForSelector('[data-testid="receipt-loyalty"]');
check("penukaran dengan kode berhasil", /-10/.test(((await pos.getByTestId("receipt-loyalty").textContent()) ?? "")));
await pos.getByTestId("receipt-close").click();

// ---------------------------------------------------------------- Back Office: feedback, pelanggan, ekspor
await bo.goto(`${base}/id/feedback`, { waitUntil: "networkidle" });
const fb = await until(async () => ({ ok: (await bo.getByTestId("fb-good").textContent())?.trim() === "1" && (await bo.getByTestId("fb-bad").textContent())?.trim() === "1" }));
check("masukan: 1 baik dan 1 buruk", fb.ok);
await bo.getByPlaceholder("Tulis balasan").first().fill("Terima kasih atas masukannya");
await bo.getByRole("button", { name: "Balas", exact: true }).first().click();
await bo.waitForSelector("text=Dibalas oleh");
check("balasan tersimpan dan tampil dengan nama pembalas", true);
await bo.screenshot({ path: `${out}/03-feedback.png` });

await bo.goto(`${base}/id/customers`, { waitUntil: "networkidle" });
await row(bo, "Andi Uji").getByRole("button", { name: /Riwayat poin/ }).click();
await bo.getByTestId("detail-points").waitFor();
const hist = ((await bo.getByRole("dialog").textContent()) ?? "").replace(/\s+/g, " ");
check("riwayat poin memuat bonus, dapat poin, tukar reward, dan penyesuaian", ["Bonus member baru", "Dapat poin", "Tukar reward", "Penyesuaian"].every((k) => hist.includes(k)), hist.slice(0, 120));
await bo.screenshot({ path: `${out}/04-customer-history.png` });
await bo.keyboard.press("Escape");
const [dl] = await Promise.all([bo.waitForEvent("download"), bo.getByRole("button", { name: "Ekspor CSV" }).click()]);
await dl.saveAs(`${out}/customers.csv`);
const bytes = fs.readFileSync(`${out}/customers.csv`);
const csv = bytes.toString("utf8");
check("ekspor pelanggan: BOM, header Indonesia, baris Andi", bytes[0] === 0xef && /Nama,Telepon,Email/.test(csv) && csv.includes("Andi Uji"), csv.split("\r\n")[0]);

await bo.goto(`${base}/ar/loyalty`, { waitUntil: "networkidle" });
await bo.getByTestId("loyalty-enabled").waitFor();
check("halaman loyalty berbahasa Arab memakai RTL", (await bo.evaluate(() => document.documentElement.dir)) === "rtl");

await browser.close();
console.log(failures === 0 ? "\nSEMUA PEMERIKSAAN BROWSER LULUS" : `\n${failures} PEMERIKSAAN GAGAL`);
if (problems.length) console.log(["", "MASALAH BROWSER:", ...problems].join("\n"));
process.exit(failures ? 1 : 0);
