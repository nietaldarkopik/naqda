// Verifikasi browser Fase 8C: tata letak kasir di ponsel, tablet tegak/mendatar, dan Arab (RTL). Memeriksa: tanpa gulir
// horizontal, keranjang sebagai panel dari bilah bawah di layar sempit, jalur jual-bayar lewat sentuhan, target sentuh >= 44px
// pada aksi utama, tombol layar penuh. Prasyarat sama seperti verify_phase8.mjs (API + web PRODUKSI berjalan, data demo,
// Playwright). Ini emulasi di desktop: BUKAN pengganti uji di perangkat tablet/ponsel nyata.
import { chromium, devices, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p8c", import.meta.url));
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
await call("POST", "items", { name: `Kopi ${run}`, variants: [{ name: "R", basePrice: 22000, sku: `K-${run}` }] });
const outlets = (await call("GET", "outlets?pageSize=100")).items;
const pusat = outlets.find((o) => /Pusat/.test(o.name)) ?? outlets[0];
const employees = (await call("GET", "employees?pageSize=100")).items;
await call("POST", `employees/${employees.find((e) => e.email === "kasir@naqdi.test").id}/pin`, { pin: PIN });

const browser = await chromium.launch();
process.on("uncaughtException", (e) => {
  console.log("GALAT:", String(e.message).split(/\r?\n/)[0]);
  process.exit(1);
});

const profiles = [
  { name: "ponsel-390", locale: "id", viewport: { width: 390, height: 844 }, touch: true, narrow: true },
  { name: "ponsel-ar", locale: "ar", viewport: { width: 390, height: 844 }, touch: true, narrow: true },
  { name: "tablet-tegak-768", locale: "id", viewport: { width: 768, height: 1024 }, touch: true, narrow: true },
  { name: "tablet-mendatar-1024", locale: "id", viewport: { width: 1024, height: 768 }, touch: true, narrow: false },
  { name: "tablet-mendatar-1280", locale: "id", viewport: { width: 1280, height: 800 }, touch: true, narrow: false },
];

for (const p of profiles) {
  console.log(`\n== ${p.name} (${p.viewport.width}x${p.viewport.height}, ${p.locale})`);
  const dev = await call("POST", "devices", { outletId: pusat.id, name: `${p.name} ${run}` });
  const ctx = await browser.newContext({ viewport: p.viewport, hasTouch: p.touch, isMobile: p.viewport.width < 1000, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tap = (loc) => loc.tap();

  await page.goto(`${base}/${p.locale}/pos`, { waitUntil: "networkidle" });
  await page.locator('input[autocomplete="off"]').fill(dev.activationCode);
  await page.locator("form button[type=submit], form button").last().tap();
  await page.getByRole("button", { name: /Kasir/ }).first().waitFor();
  await page.getByRole("button", { name: /Kasir/ }).first().tap();
  for (const d of PIN) await tap(page.locator("div[dir=ltr] button", { hasText: new RegExp(`^${d}$`) }).first());
  await page.screenshot({ path: `${out}/${p.name}-1-pin.png` });
  const keys = await page.locator("div[dir=ltr] button").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check("tombol PIN setinggi >= 44px", Math.min(...keys) >= 44, `min=${Math.min(...keys)}px`);
  await tap(page.locator("div[dir=ltr] button").last());
  await page.getByLabel(/./).first().waitFor();
  const needsShift = await page.locator("input[inputmode=decimal]").isVisible().catch(() => false);
  if (needsShift) {
    await page.locator("input[inputmode=decimal]").fill("100000");
    await page.locator("form button[type=submit]").tap();
  }
  await page.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).first().waitFor();
  await page.screenshot({ path: `${out}/${p.name}-2-sell.png` });

  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check("tanpa gulir horizontal", !(await overflowX()));
  check("dir sesuai bahasa", (await page.evaluate(() => document.documentElement.dir)) === (p.locale === "ar" ? "rtl" : "ltr"));
  const bar = page.getByTestId("open-cart");
  const panel = page.getByTestId("cart-panel");
  if (p.narrow) {
    check("bilah keranjang di bawah terlihat; panel keranjang tersembunyi", (await bar.isVisible()) && !(await panel.isVisible()));
    const bh = (await bar.boundingBox()).height;
    check("bilah keranjang setinggi >= 44px", bh >= 44, `${Math.round(bh)}px`);
    const box = await bar.boundingBox();
    check("bilah keranjang di dalam layar", box.y + box.height <= p.viewport.height + 1);
  } else {
    check("layar lebar: panel keranjang tampil di samping, bilah bawah tidak ada", (await panel.isVisible()) && !(await bar.isVisible()));
  }

  // jual: tambah item -> (buka keranjang) -> bayar -> struk
  await tap(page.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).first());
  await tap(page.getByRole("button", { name: new RegExp(`Kopi ${run}`) }).first());
  if (p.narrow) {
    await page.waitForFunction(() => document.querySelector('[data-testid="cart-count"]')?.textContent?.match(/2/));
    check("bilah keranjang menampilkan jumlah item dan total", /2/.test(await page.getByTestId("cart-count").textContent()) && /\d/.test(await page.getByTestId("cart-total-bar").textContent()));
    await tap(bar);
    await panel.waitFor();
    await page.screenshot({ path: `${out}/${p.name}-3-cart.png` });
    check("panel keranjang menutupi layar", (await overflowX()) === false);
    const qty = await page.locator('[data-testid="cart-panel"] ul button[aria-label]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check("tombol jumlah +/- setinggi >= 44px", qty.length > 0 && Math.min(...qty) >= 44, `min=${Math.min(...qty)}px`);
  }
  await page.waitForFunction(() => (document.querySelector('[data-testid="cart-total"]')?.textContent ?? "").replace(/\D/g, "") !== "0");
  const payBtn = page.locator('[data-testid="cart-panel"] button', { hasText: /^(Bayar|دفع)$/ }).first();
  const pb = await payBtn.boundingBox();
  check("tombol Bayar terjangkau di dalam layar", pb !== null && pb.y >= 0 && pb.y + pb.height <= p.viewport.height + 1 && pb.height >= 44, pb ? `${Math.round(pb.height)}px` : "");
  await tap(payBtn);
  await page.getByTestId("confirm-pay").waitFor();
  await page.screenshot({ path: `${out}/${p.name}-4-pay.png` });
  check("dialog bayar tidak melebihi lebar layar", !(await overflowX()));
  await tap(page.getByRole("dialog").locator("button", { hasText: /^(Pas|المبلغ بالضبط|Exact)$/ }).first());
  await tap(page.getByTestId("confirm-pay"));
  await page.getByTestId("receipt").waitFor();
  await page.screenshot({ path: `${out}/${p.name}-5-receipt.png` });
  check("struk tampil dan muat di layar", (await page.getByTestId("receipt").boundingBox()).width <= p.viewport.width);
  await tap(page.getByTestId("receipt-close"));
  if (p.narrow) check("setelah bayar, panel keranjang menutup kembali ke katalog", !(await panel.isVisible()));

  // Layar penuh
  const fs1 = page.getByTestId("fullscreen-toggle");
  if (await fs1.isVisible().catch(() => false)) {
    await fs1.click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 3000 }).then(
      () => check("tombol layar penuh masuk mode layar penuh", true),
      () => check("tombol layar penuh masuk mode layar penuh", false),
    );
    await fs1.click().catch(() => undefined);
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => undefined);
  } else check("tombol layar penuh tersedia", false);

  check("tanpa galat halaman", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} GAGAL`);
process.exit(failures === 0 ? 0 : 1);
