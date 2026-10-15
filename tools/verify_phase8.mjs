// Verifikasi browser Fase 8: kasir menjual 20 transaksi tanpa internet, memuat ulang halaman saat offline,
// lalu sinkron (dengan satu jawaban server yang "hilang") tanpa duplikat dan dengan nomor struk berurutan.
// Prasyarat: API dan web PRODUKSI berjalan (npm run build; npm run start:api; npm --prefix apps/web run start),
// data demo ada, Playwright terpasang. Mengubah database (item, perangkat, dan 20 order baru).
import { chromium, request as pwRequest } from "playwright";
import mysql from "mysql2/promise";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p8", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const PASSWORD = process.env.DEMO_PASSWORD ?? "Naqdi123!";
const PIN = "482615";
const SALES = 20;

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const problems = [];
const watch = (page, name) => {
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`${name} 5xx: ${r.url()}`));
};

// ---- data awal lewat API
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
const startedAt = new Date(Date.now() - 2000);
await call("POST", "items", { name: `Kopi ${run}`, variants: [{ name: "R", basePrice: 22000, sku: `K-${run}` }] });
await call("POST", "items", { name: `Teh ${run}`, variants: [{ name: "R", basePrice: 10000, sku: `T-${run}` }] });
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const employees = (await call("GET", "employees?pageSize=100")).items;
await call("POST", `employees/${employees.find((e) => e.email === "kasir@naqdi.test").id}/pin`, { pin: PIN });
const dev = await call("POST", "devices", { outletId: (outlets.find((o) => /Pusat/.test(o.name)) ?? outlets[0]).id, name: `Tablet ${run}` });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
const page = await ctx.newPage();
watch(page, "POS");
process.on("uncaughtException", async (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  try {
    await page.screenshot({ path: `${out}/gagal.png` });
  } catch {}
  process.exit(1);
});

const pressPin = async () => {
  for (const d of PIN) await page.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first().click();
};
const signIn = async () => {
  await page.getByRole("button", { name: /Kasir/ }).first().click();
  await pressPin();
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.getByLabel("Uang di laci saat buka").or(page.getByTestId("cart-total")).first().waitFor();
  if (await page.getByLabel("Uang di laci saat buka").isVisible()) {
    await page.getByLabel("Uang di laci saat buka").fill("100000");
    await page.getByRole("button", { name: "Buka shift" }).click();
  }
  await page.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).first().waitFor();
};
const cartTotal = async () => (await page.getByTestId("cart-total").textContent()).replace(/\D/g, "");

// ================================================================ online: aktivasi, login, simpan data acuan
await page.goto(`${base}/id/pos`, { waitUntil: "networkidle" });
await page.getByLabel("Kode aktivasi").fill(dev.activationCode);
await page.getByRole("button", { name: "Aktifkan" }).click();
await page.waitForSelector("text=Pilih nama Anda");
await signIn();
check("kasir masuk dan katalog tampil (online)", true);

// Service Worker aktif dan aset tersimpan
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { active: Boolean(reg.active), scope: reg.scope };
});
check("Service Worker aktif", sw.active, sw.scope);
await page.waitForFunction(async () => {
  const names = await caches.keys();
  if (!names.includes("naqdi-pages-v1") || !names.includes("naqdi-assets-v1")) return false;
  return (await (await caches.open("naqdi-assets-v1")).keys()).length > 3 && (await (await caches.open("naqdi-pages-v1")).keys()).length >= 1;
}, null, { timeout: 15000 });
check("halaman kasir dan aset aplikasi tersimpan di cache", true);

// Harga online (server) untuk keranjang pembanding
const kopi = () => page.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).first();
const teh = () => page.getByRole("button", { name: new RegExp(`Teh ${run}`) }).first();
await kopi().click();
await kopi().click();
await teh().click();
await page.waitForFunction(() => document.querySelector('[data-testid="cart-total"]')?.textContent?.replace(/\D/g, "") !== "0");
await page.waitForTimeout(400);
const onlineTotal = await cartTotal();
await page.screenshot({ path: `${out}/01-online.png` });
check("badge sync menunjukkan online", (await page.getByTestId("sync-badge").getAttribute("data-online")) === "true");

// ================================================================ offline
await ctx.setOffline(true);
await page.getByTestId("offline-banner").waitFor();
check("banner offline muncul dan badge berubah", (await page.getByTestId("sync-badge").getAttribute("data-online")) === "false");
await page.waitForTimeout(400);
const offlineTotal = await cartTotal();
check("total keranjang offline (dihitung di perangkat) sama dengan total server", onlineTotal === offlineTotal, `server=${onlineTotal} perangkat=${offlineTotal}`);
await page.screenshot({ path: `${out}/02-offline-cart.png` });
// kosongkan keranjang lewat tombol "Kosongkan"
await page.getByRole("button", { name: /Kosongkan/ }).click().catch(() => undefined);

const sellOnce = async (i) => {
  await kopi().click();
  if (i % 2) await teh().click();
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  if (i % 3 === 0) await page.locator("div[role=dialog] button", { hasText: /Rp\s?100\.000/ }).first().click();
  else await page.getByRole("dialog").getByRole("button", { name: "Pas" }).first().click();
  await page.getByTestId("confirm-pay").click();
  await page.getByTestId("offline-receipt-note").waitFor();
  if (i === 0) await page.screenshot({ path: `${out}/03-offline-receipt.png` });
  const receipt = (await page.getByTestId("receipt").textContent()).replace(/\s+/g, " ");
  await page.getByTestId("receipt-close").click();
  return receipt;
};
let firstReceipt = "";
for (let i = 0; i < SALES; i++) {
  const r = await sellOnce(i);
  if (i === 0) firstReceipt = r;
}
check("struk sementara memuat rujukan OFF-", /OFF-\d{6}-\d{4}/.test(firstReceipt), firstReceipt.slice(0, 60));
const pending = Number(await page.getByTestId("sync-badge").getAttribute("data-pending"));
check(`${SALES} penjualan menunggu sinkron di antrean`, pending === SALES, `pending=${pending}`);
await page.getByTestId("sync-badge").click();
await page.getByTestId("sync-pending").first().waitFor();
check("daftar antrean menampilkan semua penjualan", (await page.getByTestId("sync-pending").count()) === SALES);
await page.screenshot({ path: `${out}/04-queue.png` });
await page.keyboard.press("Escape");

// muat ulang halaman saat offline: aplikasi tetap terbuka dari cache dan antrean tidak hilang
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByText(/Masuk kasir|Tidak bisa terhubung|Pilih nama Anda/).first().waitFor({ timeout: 15000 });
check("muat ulang saat offline: aplikasi kasir tetap terbuka (dari cache)", true);
await page.screenshot({ path: `${out}/05-reload-offline.png` });
const queued = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open("naqdi-pos", 1);
      open.onsuccess = () => {
        const req = open.result.transaction("kv").objectStore("kv").getAllKeys();
        req.onsuccess = () => resolve(req.result.filter((k) => String(k).startsWith("queue\u0000")).length);
      };
    }),
);
check("antrean tetap utuh di IndexedDB setelah muat ulang", queued === SALES, `tersimpan=${queued}`);

// ================================================================ online kembali: respons server pertama "hilang"
let dropped = 0;
let syncCalls = 0;
await page.route("**/api/v1/pos/sync", async (route) => {
  syncCalls++;
  if (dropped === 0) {
    dropped++;
    await route.fetch(); // server memprosesnya...
    await route.abort("failed"); // ...tetapi jawabannya tidak sampai
  } else await route.continue();
});
await ctx.setOffline(false);
await page.reload({ waitUntil: "networkidle" });
await page.getByText("Pilih nama Anda").waitFor();
await signIn();
await page.waitForFunction(() => document.querySelector('[data-testid="sync-badge"]')?.getAttribute("data-online") === "true");
// jawaban yang hilang membuat status sempat offline; "online" memicu pengecekan ulang lalu pengiriman ulang
for (let i = 0; i < 40; i++) {
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const left = Number(await page.getByTestId("sync-badge").getAttribute("data-pending"));
  const on = (await page.getByTestId("sync-badge").getAttribute("data-online")) === "true";
  if (on && left === 0) break;
  await page.waitForTimeout(500);
}
check("jawaban server pertama sengaja dihilangkan lalu dikirim ulang", dropped === 1 && syncCalls >= 2, `panggilan sync=${syncCalls}`);
check("antrean kosong setelah sinkron", Number(await page.getByTestId("sync-badge").getAttribute("data-pending")) === 0);
await page.getByTestId("sync-badge").click();
await page.getByTestId("sync-done").first().waitFor();
check("riwayat sinkron memetakan OFF-… ke nomor struk resmi", /OFF-\d{6}-\d{4}\s*→\s*#\d+/.test((await page.getByTestId("sync-done").first().textContent()).replace(/\s+/g, " ")));
await page.screenshot({ path: `${out}/06-synced.png` });

// ================================================================ bukti di database
const since = startedAt.toISOString().slice(0, 19).replace("T", " "); // kolom waktu disimpan UTC
const db = await mysql.createConnection({ host: "127.0.0.1", port: 3306, user: "root", database: "naqdi" });
const [rows] = await db.query(
  `SELECT o.id, o.receipt_number AS n, o.status, o.total
     FROM orders o JOIN order_activities a ON a.order_id = o.id AND a.kind = 'paid'
    WHERE JSON_EXTRACT(a.detail, '$.offline.clientRef') IS NOT NULL AND o.opened_at >= ? ORDER BY o.receipt_number`,
  [since],
);
const ids = new Set(rows.map((r) => r.id));
const nums = rows.map((r) => Number(r.n));
check(`database memuat tepat ${SALES} order offline (tanpa duplikat)`, rows.length === SALES && ids.size === SALES, `baris=${rows.length}`);
check("nomor struk berurutan tanpa celah", nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), `${nums[0]}..${nums.at(-1)}`);
check("semua order berstatus lunas", rows.every((r) => r.status === "paid"));
const [[cnt]] = await db.query("SELECT COUNT(*) c FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.opened_at >= ? AND o.id IN (?)", [since, ids.size ? [...ids] : ["-"]]);
check("pembayaran tercatat sekali per order", Number(cnt.c) === SALES, `payments=${cnt.c}`);
await db.end();

// ================================================================ Arab (RTL): lencana, spanduk, dan dialog offline
await page.unroute("**/api/v1/pos/sync");
await page.goto(`${base}/ar/pos`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Kasir/ }).first().click();
await pressPin();
await page.locator("div[dir=ltr] button").last().click();
await page.getByTestId("cart-total").waitFor();
check("tata letak Arab memakai dir=rtl", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
await ctx.setOffline(true);
await page.getByTestId("offline-banner").waitFor();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check("layar offline Arab tanpa gulir horizontal", !overflow);
await page.screenshot({ path: `${out}/07-offline-ar.png` });
await page.getByTestId("sync-badge").click();
await page.getByRole("dialog").waitFor();
const dialogBox = await page.getByRole("dialog").boundingBox();
check("dialog sinkron Arab berada di dalam layar", dialogBox !== null && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 1280);
await page.screenshot({ path: `${out}/08-sync-dialog-ar.png` });
await ctx.setOffline(false);

check("tidak ada galat halaman atau 5xx", problems.length === 0, problems.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
process.exit(failures === 0 ? 0 : 1);
