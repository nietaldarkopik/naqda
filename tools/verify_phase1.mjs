import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const base = "http://localhost:3000";
// Akhiran "/" penting: path relatif dijoin ke /api/v1/, sedangkan path berawalan "/" menggantikan seluruh path.
const apiBase = "http://127.0.0.1:4000/api/v1/";
const out = fileURLToPath(new URL("../build/web-shots-p1", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const run = Date.now().toString(36).slice(-5);

// PNG 1x1 yang valid (merah), agar <img> benar-benar bisa dirender.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngPath = `${out}/pixel.png`;
fs.writeFileSync(pngPath, Buffer.from(PNG_BASE64, "base64"));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => ["error", "warning"].includes(m.type()) && !/status of (401|403|409|422)/.test(m.text()) && problems.push(`console ${m.type()}: ${m.text().slice(0, 300)}`));
page.on("response", (r) => r.status() >= 500 && problems.push(`5xx: ${r.url()}`));
process.on("exit", () => problems.length && console.log(["", "MASALAH BROWSER (saat keluar):", ...problems].join("\n")));

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
// Daftar berhalaman (10 baris) dan data menumpuk antar-jalan, jadi selalu cari lewat kotak pencarian.
const seek = async (text) => {
  await page.locator('input[type="search"]').first().fill(text);
  await page.waitForSelector(`tbody tr:has-text("${text}")`);
};
const rowText = async (text) => (await page.locator("tr", { hasText: text }).first().textContent()).replace(/\s+/g, " ");

// --- helper API langsung (untuk memeriksa keadaan data, bukan untuk mengubahnya)
const api = await pwRequest.newContext({ baseURL: apiBase });
const rel = (path) => path.replace(/^\//, "");
const apiLogin = async (email, password) => {
  const res = await api.post("auth/login", { data: { email, password } });
  if (!res.ok()) throw new Error(`login API gagal: ${res.status()}`);
  return (await res.json()).accessToken;
};
const apiGet = async (token, path) => {
  const res = await api.get(rel(path), { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`GET ${path} gagal: ${res.status()}`);
  return res.json();
};

const login = async (email, password, lang = "id") => {
  await page.goto(`${base}/${lang}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/${lang}/dashboard`);
};

await login("admin@naqdi.test", "Naqdi123!");
const adminToken = await apiLogin("admin@naqdi.test", "Naqdi123!");

// ============ ITEM: daftar, buat, SKU ganda, edit ============
await page.click("summary:has-text('Library')");
await page.click("a:has-text('Item')");
await page.waitForURL("**/id/items");
await seek("Kopi Susu");
check("daftar item menampilkan data demo", (await page.locator("tbody tr").count()) >= 6);
await shot("01-items-id");

const sku1 = `RB-CK-${run}`;
const sku2 = `RB-KJ-${run}`;
await page.click("button:has-text('Tambah item')");
let dlg = page.locator('[role="dialog"]');
await dlg.getByLabel("Nama", { exact: true }).fill(`Roti Bakar ${run}`);
await dlg.locator("select").first().selectOption({ label: "Makanan" });
await dlg.getByLabel("Nama varian").nth(0).fill("Cokelat");
await dlg.getByLabel("SKU").nth(0).fill(sku1);
await dlg.getByLabel("Harga dasar").nth(0).fill("15000");
await dlg.getByLabel("Modal").nth(0).fill("6000");
await dlg.getByLabel("Take Away").nth(0).fill("17000");
await dlg.getByRole("button", { name: "Tambah varian" }).click();
await dlg.getByLabel("Nama varian").nth(1).fill("Keju");
await dlg.getByLabel("SKU").nth(1).fill(sku2);
await dlg.getByLabel("Harga dasar").nth(1).fill("18000");

// gambar: unggah PNG, pratinjau tampil
await dlg.locator('input[type="file"]').setInputFiles(pngPath);
await dlg.locator("img").first().waitFor();
const previewOk = await dlg.locator("img").first().evaluate((img) => img.complete && img.naturalWidth > 0);
check("unggah gambar: pratinjau benar-benar ter-render", previewOk);

// terjemahan nama
await dlg.getByLabel("Nama (English)").fill(`Toasted Bread ${run}`);
await dlg.getByLabel("Nama (العربية)").fill("خبز محمص");
await shot("02-item-form-id");
await dlg.getByRole("button", { name: "Simpan" }).click();
await page.waitForSelector("text=Tersimpan");
await seek(`Roti Bakar ${run}`);
const txt = await rowText(`Roti Bakar ${run}`);
check("item baru: 2 varian dan rentang harga", txt.includes("2 varian") && txt.includes("15.000") && txt.includes("18.000"), txt.slice(0, 80));
const thumbOk = await page.locator("tr", { hasText: `Roti Bakar ${run}` }).locator("img").evaluate((img) => img.complete && img.naturalWidth > 0);
check("miniatur gambar di tabel ter-render", thumbOk);

// terjemahan tersimpan di server dan dimuat kembali saat edit
await page.locator("tr", { hasText: `Roti Bakar ${run}` }).getByRole("button", { name: /Ubah/ }).click();
await page.waitForSelector('[role="dialog"] input[value="Cokelat"]');
dlg = page.locator('[role="dialog"]');
check("terjemahan dimuat ulang saat edit", (await dlg.getByLabel("Nama (English)").inputValue()) === `Toasted Bread ${run}` && (await dlg.getByLabel("Nama (العربية)").inputValue()) === "خبز محمص");
check("harga dasar dan harga Take Away dimuat benar", (await dlg.getByLabel("Harga dasar").nth(0).inputValue()) === "15000" && (await dlg.getByLabel("Take Away").nth(0).inputValue()) === "17000");
await page.keyboard.press("Escape");

// SKU ganda
await page.click("button:has-text('Tambah item')");
dlg = page.locator('[role="dialog"]');
await dlg.getByLabel("Nama", { exact: true }).fill("Roti Tiruan");
await dlg.getByLabel("Nama varian").nth(0).fill("Reguler");
await dlg.getByLabel("SKU").nth(0).fill(sku1);
await dlg.getByLabel("Harga dasar").nth(0).fill("1000");
await dlg.getByRole("button", { name: "Simpan" }).click();
await page.waitForSelector("text=SKU sudah dipakai produk lain");
check("SKU ganda menampilkan galat di baris varian", true);
await page.keyboard.press("Escape");

// ekspor + impor
const [download] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Ekspor')")]);
await download.saveAs(`${out}/export.csv`);
const csvText = fs.readFileSync(`${out}/export.csv`, "utf8");
check("ekspor CSV memuat kolom modifiers dan track_stock", csvText.startsWith("\uFEFFname,category,brand,variant,sku,price,cost,status,description,modifiers,track_stock") && csvText.includes(`Roti Bakar ${run}`));

fs.writeFileSync(`${out}/bad.csv`, "name,variant,sku,price,modifiers\nImpor A,R,IMP-A,1000,\n,R,IMP-B,2000,\nImpor C,R,IMP-C,12x,\nImpor D,R,IMP-D,500,Tidak Ada\n");
await page.click("button:has-text('Impor')");
await page.setInputFiles('input[type="file"]', `${out}/bad.csv`);
await page.click("button:has-text('Periksa dulu')");
await page.waitForSelector("text=Nama item wajib diisi");
const errText = await page.locator('[role="status"]').textContent();
check("impor bermasalah: nomor baris dan alasan, termasuk modifier tak dikenal", errText.includes("Baris 3") && errText.includes("Baris 4") && errText.includes("Modifier tidak dikenal: Tidak Ada"), errText.replace(/\s+/g, " ").slice(0, 120));
check("tombol Terapkan nonaktif saat ada galat", await page.getByRole("button", { name: "Terapkan impor" }).isDisabled());
await shot("03-import-errors-id");
fs.writeFileSync(`${out}/good.csv`, `name,category,variant,sku,price,modifiers,track_stock,price:Take Away\nImpor Sukses ${run},Baru dari CSV,Reguler,IMP-OK-${run},9000,Topping,yes,10000\n`);
await page.setInputFiles('input[type="file"]', `${out}/good.csv`);
await page.click("button:has-text('Periksa dulu')");
await page.waitForSelector("text=Pemeriksaan lolos");
await page.getByRole("button", { name: "Terapkan impor" }).click();
await page.waitForSelector("text=Impor selesai");
await page.getByRole("button", { name: "Tutup" }).first().click();
await seek(`Impor Sukses ${run}`);
check("impor valid menambah item", true);

// ============ OUTLET: mode pajak + katalog otomatis ============
await page.goto(`${base}/id/outlets`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Naqdi Demo - Pusat");
check("kolom mode pajak tampil; outlet demo = Ditambahkan", (await rowText("Naqdi Demo - Pusat")).includes("Ditambahkan"));

await page.click("button:has-text('Tambah outlet')");
dlg = page.locator('[role="dialog"]');
check("outlet baru: opsi katalog otomatis aktif secara bawaan", await dlg.getByLabel("Sediakan seluruh katalog di outlet ini").isChecked());
await dlg.getByLabel("Nama", { exact: true }).fill(`Toko Inklusif ${run}`);
await dlg.getByLabel("Harga sudah termasuk pajak").check();
await shot("04-outlet-form-id");
await dlg.getByRole("button", { name: "Simpan" }).click();
await seek(`Toko Inklusif ${run}`);
check("outlet baru ditandai 'Termasuk di harga'", (await rowText(`Toko Inklusif ${run}`)).includes("Termasuk di harga"));

// katalog benar-benar tersedia di outlet baru (periksa data di server)
const outletList = await apiGet(adminToken, "/outlets?pageSize=100");
const newOutlet = outletList.items.find((o) => o.name === `Toko Inklusif ${run}`);
const rotiList = await apiGet(adminToken, `/items?q=Roti%20Bakar%20${run}`);
const roti = await apiGet(adminToken, `/items/${rotiList.items[0].id}`);
check("katalog yang sudah ada otomatis tersedia di outlet baru", roti.outletIds.includes(newOutlet.id));
check("mode pajak tersimpan di server (inklusif) dan outlet lain tetap", newOutlet.pricesIncludeTax === true && outletList.items.find((o) => o.name === "Naqdi Demo - Pusat").pricesIncludeTax === false);

// mengubah mode memunculkan peringatan
await page.locator("tr", { hasText: "Naqdi Demo - Cabang 2" }).getByRole("button", { name: /Ubah/ }).click();
dlg = page.locator('[role="dialog"]');
check("tidak ada peringatan sebelum mode diubah", (await dlg.locator('[role="status"]').count()) === 0);
await dlg.getByLabel("Harga sudah termasuk pajak").check();
await dlg.getByText("memengaruhi total transaksi baru").waitFor();
check("peringatan muncul saat mode pajak diubah", true);
await dlg.getByLabel("Harga sudah termasuk pajak").uncheck();
check("peringatan hilang bila dikembalikan", (await dlg.locator('[role="status"]').count()) === 0);
await page.keyboard.press("Escape");

// ============ KATEGORI, DISKON, PAJAK ============
await page.goto(`${base}/id/categories`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Minuman Dingin");
await page.click("button:has-text('Tambah kategori')");
await page.locator("#simple-form input").first().fill(`Dessert ${run}`);
await page.getByLabel("Nama (English)").fill(`Desserts ${run}`);
await page.click('button[form="simple-form"]');
await seek(`Dessert ${run}`);
const catId = (await apiGet(adminToken, `/categories?q=Dessert%20${run}`)).items[0].id;
const catTr = await apiGet(adminToken, `/translations/category/${catId}`);
check("terjemahan kategori tersimpan", catTr.translations?.en?.name === `Desserts ${run}`);
await page.click("button:has-text('Tambah kategori')");
await page.locator("#simple-form input").first().fill(`Dessert ${run}`);
await page.click('button[form="simple-form"]');
await page.waitForSelector("text=Nama sudah dipakai");
check("kategori ganda ditolak dengan pesan di kolom", true);
await page.keyboard.press("Escape");

await page.goto(`${base}/id/discounts`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Diskon Karyawan");
check("diskon persen tampil 20%", (await rowText("Diskon Karyawan")).includes("20%"));
await page.click("button:has-text('Tambah diskon')");
await page.locator("#simple-form input").first().fill(`Potong 5rb ${run}`);
await page.locator("#simple-form select").first().selectOption("amount");
await page.locator("#simple-form input[inputmode='decimal']").fill("5000");
await page.click('button[form="simple-form"]');
await seek(`Potong 5rb ${run}`);
check("diskon nominal tampil sebagai rupiah", (await rowText(`Potong 5rb ${run}`)).includes("5.000"));
await page.click("button:has-text('Tambah diskon')");
await page.locator("#simple-form input").first().fill("Kebanyakan");
await page.locator("#simple-form input[inputmode='decimal']").fill("150");
await page.click('button[form="simple-form"]');
await page.waitForSelector("#simple-form [role='alert']");
check("persen lebih dari 100 ditolak", true);
await page.keyboard.press("Escape");

await page.goto(`${base}/id/taxes`, { waitUntil: "networkidle" });
await page.waitForSelector("text=PB1 Restoran");
check("tarif pajak 10% tampil", (await rowText("PB1 Restoran")).includes("10%"));

// ============ MODIFIER, BUNDLE ============
await page.goto(`${base}/id/modifiers`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Topping");
await page.click("button:has-text('Tambah modifier')");
await page.locator("#modifier-form input").nth(0).fill(`Level Gula ${run}`);
await page.locator("#modifier-form input[maxlength='191']").nth(1).fill("Normal");
await page.getByRole("button", { name: "Tambah opsi" }).click();
await page.locator("#modifier-form input[maxlength='191']").nth(2).fill("Less Sugar");
await page.click('button[form="modifier-form"]');
await seek(`Level Gula ${run}`);
check("modifier dengan 2 opsi tersimpan", (await rowText(`Level Gula ${run}`)).includes("Less Sugar"));

await page.goto(`${base}/id/bundles`, { waitUntil: "networkidle" });
await page.click("button:has-text('Tambah bundle')");
dlg = page.locator('[role="dialog"]');
await dlg.getByLabel("Nama", { exact: true }).fill(`Paket Sarapan ${run}`);
await dlg.getByLabel("Harga paket").fill("40000");
await dlg.locator('input[type="search"]').fill("Nasi");
await page.click("button:has-text('Nasi Goreng')");
await dlg.locator('input[type="search"]').fill("Teh");
await page.click("button:has-text('Es Teh Manis - Reguler')");
await dlg.getByRole("button", { name: "Simpan" }).click();
await seek(`Paket Sarapan ${run}`);
const bt = await rowText(`Paket Sarapan ${run}`);
check("bundle menyimpan komponen dan harga", bt.includes("Nasi Goreng") && bt.includes("40.000"));

// ============ PROMO: wizard 4 langkah ============
await page.goto(`${base}/id/promos`, { waitUntil: "networkidle" });
await page.click("button:has-text('Tambah promo')");
dlg = page.locator('[role="dialog"]');
const cont = dlg.getByRole("button", { name: "Lanjut" });
check("wizard: langkah 1 dari 4, Lanjut nonaktif tanpa nama", (await cont.isDisabled()) && (await dlg.locator('[aria-current="step"]').textContent()).includes("Informasi"));
await dlg.getByLabel("Nama", { exact: true }).fill(`Beli 2 Gratis 1 ${run}`);
await dlg.getByLabel("Jenis promo").selectOption("free_item");
check("wizard: Lanjut aktif setelah nama diisi", await cont.isEnabled());
await shot("05-promo-step1-id");
await cont.click();
check("wizard: pindah ke langkah Syarat", (await dlg.locator('[aria-current="step"]').textContent()).includes("Syarat"));
await dlg.getByLabel("Item", { exact: true }).selectOption({ label: "Kopi Susu" });
await dlg.getByLabel("Jumlah yang dibeli").fill("2");
await cont.click();
check("wizard: Lanjut nonaktif sampai item hadiah dipilih", await cont.isDisabled());
await dlg.getByLabel("Item gratis").selectOption({ label: "Americano" });
await dlg.getByRole("button", { name: "Kembali" }).click();
check("wizard: Kembali mempertahankan isian", (await dlg.getByLabel("Jumlah yang dibeli").inputValue()) === "2");
await cont.click();
console.log("  langkah setelah Lanjut #1:", (await dlg.locator('[aria-current="step"]').textContent())?.trim(), "| Lanjut aktif:", await cont.isEnabled());
await cont.click();
console.log("  langkah setelah Lanjut #2:", (await dlg.locator('[aria-current="step"]').textContent())?.trim());
await dlg.getByRole("button", { name: "Simpan" }).waitFor({ timeout: 5000 }).catch(() => undefined);
check("wizard: langkah terakhir menampilkan Simpan", await dlg.getByRole("button", { name: "Simpan" }).isVisible());
await shot("05b-promo-last-step-id");
// galat server memindahkan ke langkah yang bermasalah
await dlg.getByLabel("Mulai").fill("2026-05-02T10:00");
await dlg.getByLabel("Berakhir").fill("2026-05-01T10:00");
await dlg.getByRole("button", { name: "Simpan" }).click();
await dlg.getByText("Data yang dikirim tidak valid").first().waitFor({ timeout: 8000 }).catch(() => undefined);
check("wizard: periode terbalik ditolak dan tetap di langkah Konfigurasi", (await dlg.locator('[aria-current="step"]').textContent()).includes("Konfigurasi") && (await dlg.getByLabel("Berakhir").getAttribute("aria-invalid")) === "true");
await shot("06-promo-step4-error-id");
await dlg.getByLabel("Berakhir").fill("2026-06-01T10:00");
await dlg.getByRole("button", { name: "Simpan" }).click();
await seek(`Beli 2 Gratis 1 ${run}`);
check("promo beli-gratis tersimpan lewat wizard", (await rowText(`Beli 2 Gratis 1 ${run}`)).includes("Americano"));

// ============ AUDIT ============
await page.click("a:has-text('Jejak Audit')");
await page.waitForURL("**/id/audit");
await page.waitForSelector("td >> text=Admin Demo");
const auditRows = await page.locator("tbody tr").count();
check("halaman audit menampilkan jejak dengan nama pengguna", auditRows >= 5, `${auditRows} baris`);
await page.getByLabel("Objek").selectOption("outlet");
await page.waitForFunction(() => [...document.querySelectorAll("tbody tr")].every((r) => /Outlet/.test(r.textContent)));
const outletAudit = (await page.locator("tbody").textContent()).replace(/\s+/g, " ");
check("filter objek: hanya Outlet; perubahan mode pajak ditandai", outletAudit.includes("Toko Inklusif"));
await page.locator("tbody tr", { hasText: `Toko Inklusif ${run}` }).first().locator("summary").click();
check("rincian perubahan dapat dibuka (JSON sebelum/sesudah)", (await page.locator("pre").first().textContent()).includes("pricesIncludeTax"));
await shot("07-audit-id");
await page.getByLabel("Objek").selectOption("item");
await page.getByLabel("Aksi").selectOption("update");
await page.waitForTimeout(800);

// ============ INVESTOR: hanya melihat ============
await page.goto(`${base}/id/employees`, { waitUntil: "networkidle" });
await page.click("button:has-text('Tambah karyawan')");
dlg = page.locator('[role="dialog"]');
const invEmail = `investor-${run}@uji.test`;
await dlg.getByLabel("Nama", { exact: true }).fill("Investor Uji");
await dlg.getByLabel("Email").fill(invEmail);
await dlg.getByLabel("Peran").selectOption({ label: "Investor" });
await dlg.getByLabel("Kata sandi").fill("InvestorUji123");
await dlg.getByRole("button", { name: "Simpan" }).click();
await seek(`${invEmail}`);
await page.click("text=Keluar");
await page.waitForURL("**/id/login");
await login(invEmail, "InvestorUji123");
check("investor: menu Jejak Audit tidak tampil", (await page.locator("a:has-text('Jejak Audit')").count()) === 0);
await page.goto(`${base}/id/items`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Kopi Susu");
check("investor: tombol Tambah item dan Impor tidak ada, Ekspor ada", (await page.locator("button:has-text('Tambah item')").count()) === 0 && (await page.locator("button:has-text('Impor')").count()) === 0 && (await page.locator("button:has-text('Ekspor')").count()) === 1);
check("investor: tombol ubah/hapus tidak ada di tabel item", (await page.locator("tbody button").count()) === 0);
await page.goto(`${base}/id/audit`, { waitUntil: "networkidle" });
check("investor: halaman audit menolak akses", (await page.getByText("Anda tidak memiliki izin untuk aksi ini").count()) === 1);
await page.goto(`${base}/id/outlets`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Naqdi Demo - Pusat");
check("investor: tombol Tambah outlet tidak ada", (await page.locator("button:has-text('Tambah outlet')").count()) === 0);
await shot("08-investor-items-id");
await page.click("text=Keluar");
await page.waitForURL("**/id/login");

// ============ ARAB & INGGRIS ============
await login("admin@naqdi.test", "Naqdi123!", "ar");
await page.goto(`${base}/ar/outlets`, { waitUntil: "networkidle" });
await page.waitForSelector("text=إضافة فرع");
await page.click("button:has-text('إضافة فرع')");
await page.waitForSelector('[role="dialog"]');
await shot("09-outlet-form-ar");
await page.keyboard.press("Escape");
await page.goto(`${base}/ar/audit`, { waitUntil: "networkidle" });
await page.waitForSelector("text=سجل التدقيق");
const rtl = await page.evaluate(() => ({ dir: document.documentElement.dir, right: Math.round(document.querySelector("aside").getBoundingClientRect().right), vw: innerWidth }));
check("audit Arab: RTL dan sidebar di kanan", rtl.dir === "rtl" && rtl.right >= rtl.vw - 1, JSON.stringify(rtl));
await shot("10-audit-ar");
await page.goto(`${base}/ar/promos`, { waitUntil: "networkidle" });
await page.click("button:has-text('إضافة عرض')");
await page.waitForSelector('[role="dialog"]');
await shot("11-promo-wizard-ar");
await page.goto(`${base}/ar/items`, { waitUntil: "networkidle" });
await page.click("button:has-text('إضافة صنف')");
await page.waitForSelector('[role="dialog"]');
await shot("12-item-form-ar");
await page.goto(`${base}/en/items`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Add item");
await shot("13-items-en");

console.log(problems.length ? `\nMASALAH BROWSER:\n${problems.join("\n")}` : "\nTidak ada galat konsol/5xx yang tak terduga.");
console.log(failures ? `\n${failures} pemeriksaan GAGAL` : "\nSemua pemeriksaan browser lolos.");
await browser.close();
await api.dispose();
process.exit(failures ? 1 : 0);
