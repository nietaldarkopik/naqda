// Verifikasi browser Fase 4: dasbor, laporan, transaksi, ekspor CSV, RTL. Data penjualan dibuat lewat API kasir (jalur yang sama
// dengan aplikasi kasir; tampilan kasir sudah diperiksa di fase 2-3), lalu angkanya dibaca di Back Office dan dicocokkan dengan hitungan tangan.
// Prasyarat: API :4000 dan web :3000 dengan data demo (Rahasia123!) pada database yang BERSIH.
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p4", import.meta.url));
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

// ---------------------------------------------------------------- data lewat API
const api = await pwRequest.newContext({ baseURL: apiBase });
const token = (await (await api.post("auth/login", { data: { email: "admin@naqdi.test", password: PASSWORD } })).json()).accessToken;
const H = { authorization: `Bearer ${token}` };
const call = async (method, path, data, headers = H) => {
  const res = await api.fetch(path, { method, data, headers });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
};
const run = Date.now().toString(36).slice(-4);
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const pusat = outlets.find((o) => /Pusat/.test(o.name));
const types = (await call("GET", "sales-types")).items;
const takeAway = types.find((t) => /take/i.test(t.name)).id;
const itemName = `Kopi ${run}`;
const item = await call("POST", "items", { name: itemName, variants: [{ name: "R", basePrice: 22000, cost: 8000, sku: `K-${run}` }] });
const kopi = item.variants[0].id;
const general = await call("POST", "discounts", { name: `Umum ${run}`, kind: "percent", value: 1000, allOutlets: true });
const employees = (await call("GET", "employees?pageSize=100")).items;
const uid = (email) => employees.find((e) => e.email === email).id;
await call("POST", `employees/${uid("kasir@naqdi.test")}/pin`, { pin: CASHIER_PIN });
await call("POST", `employees/${uid("admin@naqdi.test")}/pin`, { pin: ADMIN_PIN });

const pair = async (email, pin, name) => {
  const dev = await call("POST", "devices", { outletId: pusat.id, name });
  const act = await call("POST", "pos/devices/activate", { code: dev.activationCode }, {});
  const login = await call("POST", "pos/auth/pin", { userId: uid(email), pin }, { "x-device-token": act.deviceToken });
  return { "x-device-token": act.deviceToken, authorization: `Bearer ${login.accessToken}` };
};
const cashier = await pair("kasir@naqdi.test", CASHIER_PIN, `K ${run}`);
const admin = await pair("admin@naqdi.test", ADMIN_PIN, `A ${run}`);
await call("POST", "pos/shifts/open", { openingCash: 100000 }, cashier);
await call("POST", "pos/shifts/open", { openingCash: 0 }, admin);
const line = (q) => ({ kind: "item", variantId: kopi, quantity: q, modifierOptionIds: [] });
const bill = async (who, lines, extra = {}) => (await call("POST", "pos/orders", { salesTypeId: takeAway, lines, ...extra }, who)).order;
const pay = (who, id, method, amount) => call("POST", `pos/orders/${id}/pay`, { payments: [{ method, amount }] }, who);

const o1 = await bill(cashier, [line(3)]);
await pay(cashier, o1.id, "cash", 200000);
const o2 = await bill(cashier, [line(1)]);
await pay(cashier, o2.id, "card", o2.totals.total);
const o3 = await bill(admin, [line(2)], { orderDiscount: { discountId: general.id } });
await pay(admin, o3.id, "cash", 200000);
const approval = { userId: uid("admin@naqdi.test"), pin: ADMIN_PIN };
await call("POST", `pos/orders/${o1.id}/refund`, { lines: [{ lineId: o1.lines[0].id, quantity: 1 }], method: "cash", reason: "salah menu", approval }, cashier);
const o5 = await bill(cashier, [line(2)]);
await call("POST", `pos/orders/${o5.id}/void`, { reason: "tamu pergi", approval }, cashier);

// ---------------------------------------------------------------- browser
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
watch(page, "BO");
let currentPage = page;
process.on("uncaughtException", async (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  try {
    await currentPage.screenshot({ path: `${out}/gagal.png` });
  } catch {}
  process.exit(1);
});
await page.goto(`${base}/id/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', "admin@naqdi.test");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL("**/id/dashboard");

const money = (n) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const kpi = async (k) => ((await page.getByTestId(`kpi-${k}`).textContent()) ?? "").replace(/\s/g, " ").trim();
const waitKpi = async (k, text) => page.waitForFunction(([id, expected]) => (document.querySelector(`[data-testid="kpi-${id}"]`)?.textContent ?? "").replace(/\s/g, " ").includes(expected), [k, text], { timeout: 15000 }).catch(() => undefined);

// Hitungan tangan: O1 66.000, O2 22.000, O3 44.000 - 10% = 39.600; refund bersih 22.000.
await waitKpi("netSales", money(105600).replace("Rp ", ""));
check("dasbor: penjualan kotor Rp 132.000", (await kpi("grossSales")).includes("132.000"), await kpi("grossSales"));
check("dasbor: diskon Rp 4.400", (await kpi("discounts")).includes("4.400"), await kpi("discounts"));
check("dasbor: refund (nilai barang) Rp 22.000", (await kpi("refunds")).includes("22.000"), await kpi("refunds"));
check("dasbor: penjualan bersih Rp 105.600", (await kpi("netSales")).includes("105.600"), await kpi("netSales"));
check("dasbor: laba kotor Rp 65.600 (bersih - HPP 5 x 8.000)", (await kpi("grossProfit")).includes("65.600"), await kpi("grossProfit"));
check("dasbor: jumlah transaksi 3", (await kpi("orders")).startsWith("3"), await kpi("orders"));
check("dasbor: grafik dan perbandingan outlet tampil", (await page.locator('svg[role="img"]').count()) >= 3 && (await page.getByTestId("outlet-comparison").locator("tbody tr").count()) >= 2);
await page.screenshot({ path: `${out}/01-dashboard.png`, fullPage: true });

await page.getByRole("button", { name: "Kemarin" }).click();
await waitKpi("orders", "0");
check("filter 'Kemarin' tidak memuat penjualan hari ini", (await kpi("orders")).startsWith("0") && (await kpi("netSales")).includes("0"));
await page.getByRole("button", { name: "7 hari" }).click();
await waitKpi("netSales", "105.600");

// Laporan-laporan
const open = async (kind) => {
  await page.goto(`${base}/id/reports/${kind}`, { waitUntil: "networkidle" });
};
await open("summary");
await page.getByTestId("metric-totalCollected").waitFor();
const metric = async (k) => ((await page.getByTestId(`metric-${k}`).textContent()) ?? "").replace(/\s/g, " ");
// Total diterima = bersih + service + pajak + pembulatan
const read = async (k) => Number((await metric(k)).replace(/[^\d-]/g, "")) * (/-/.test(await metric(k)) ? -1 : 1);
const [net, grat, tax, rnd, coll] = [await read("netSales"), await read("gratuity"), await read("tax"), await read("rounding"), await read("totalCollected")];
check("ringkasan: bersih + service + pajak + pembulatan = total diterima", net + grat + tax + rnd === coll, `${net}+${grat}+${tax}+${rnd}=${coll}`);
check("ringkasan: penjualan bersih Rp 105.600", net === 105600);
await page.screenshot({ path: `${out}/02-summary.png` });

await open("items");
await page.getByTestId("report-table").locator("tbody tr").first().waitFor();
const itemRow = ((await page.getByTestId("report-table").locator("tbody tr", { hasText: itemName }).textContent()) ?? "").replace(/\s/g, " ");
check("laporan item: Kopi kotor 132.000, diskon 4.400, bersih 105.600, HPP 40.000, laba 65.600", ["132.000", "4.400", "105.600", "40.000", "65.600"].every((v) => itemRow.includes(v)), itemRow.slice(0, 200));

await open("payments");
await page.getByTestId("report-table").locator("tbody tr").first().waitFor();
const payText = ((await page.getByTestId("report-table").textContent()) ?? "").replace(/\s/g, " ");
check("laporan pembayaran: tunai dan kartu", /Tunai/.test(payText) && /Kartu/.test(payText));

await open("discounts");
await page.getByTestId("report-table").locator("tbody tr", { hasText: `Umum ${run}` }).waitFor();
check("laporan diskon memuat diskon umum yang dipakai", true);

await open("shifts");
await page.getByTestId("report-table").locator("tbody tr").first().waitFor();
check("laporan shift memuat dua shift terbuka", (await page.getByTestId("report-table").locator("tbody tr").count()) >= 2);

await open("tables");
await page.waitForSelector('[data-testid="report-table"]');
check("laporan meja terbuka (kosong karena tanpa meja)", true);

// Transaksi
await page.goto(`${base}/id/reports/transactions`, { waitUntil: "networkidle" });
await page.getByTestId("transactions").locator("tbody tr").first().waitFor();
check("transaksi: 3 transaksi berhasil", (await page.getByTestId("transactions").locator("tbody tr").count()) === 3);
await page.getByTestId("transactions").locator("tbody tr").nth(2).click(); // yang tertua = O1 (ada refund)
await page.getByTestId("tx-detail").waitFor();
const det = ((await page.getByTestId("tx-detail").textContent()) ?? "").replace(/\s/g, " ");
check("rincian transaksi memuat item, refund, dan alasan", det.includes(itemName) && /salah menu/.test(det) && /Di-refund/.test(det), det.slice(0, 120));
await page.screenshot({ path: `${out}/03-transaction.png` });
await page.keyboard.press("Escape");
await page.getByRole("tab", { name: "Dibatalkan" }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="transactions"] tbody tr').length === 1 && /tamu pergi/.test(document.querySelector('[data-testid="transactions"]').textContent));
check("tab Dibatalkan memuat bill yang dibatalkan beserta alasan", true);

// Ekspor CSV dari halaman laporan item
await open("items");
await page.getByTestId("report-table").locator("tbody tr").first().waitFor();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
const file = `${out}/items.csv`;
await dl.saveAs(file);
const bytes = fs.readFileSync(file);
const text = bytes.toString("utf8");
check("ekspor CSV: BOM, header bahasa Indonesia, baris item dan total", bytes[0] === 0xef && bytes[1] === 0xbb && /Nama,Terjual/.test(text) && text.includes(itemName) && /\r\nTotal,/.test(text), text.split("\r\n")[0]);
check("ekspor CSV: nama berkas memuat rentang tanggal", /naqdi-items-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv/.test(dl.suggestedFilename()), dl.suggestedFilename());

// RTL
await page.goto(`${base}/ar/dashboard`, { waitUntil: "networkidle" });
await page.getByTestId("kpi-netSales").waitFor();
check("dasbor Arab memakai RTL", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
await page.waitForFunction(() => !/^-$/.test(document.querySelector('[data-testid="kpi-netSales"]').textContent.trim()));
await page.screenshot({ path: `${out}/04-dashboard-rtl.png`, fullPage: true });

await browser.close();
console.log(failures === 0 ? "\nSEMUA PEMERIKSAAN BROWSER LULUS" : `\n${failures} PEMERIKSAAN GAGAL`);
if (problems.length) console.log(["", "MASALAH BROWSER:", ...problems].join("\n"));
process.exit(failures ? 1 : 0);
