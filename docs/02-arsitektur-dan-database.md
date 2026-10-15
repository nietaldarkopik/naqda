# 02. Arsitektur dan Database

Dokumen ini mendefinisikan **bagaimana** membangunnya. Bagian skema dan aturan bisnis tidak bergantung pada stack.

## 1. Stack (diputuskan: full TypeScript, tanpa PHP/Laravel)

Seluruh sistem ditulis dalam **TypeScript**: server, web, desktop, dan mobile. Alasan utamanya: aturan bisnis
(hitung total, pajak, promo, stok, shift) harus berjalan identik di server **dan** di klien offline.
Dengan satu bahasa, kodenya hanya ditulis sekali di `packages/domain`.

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Server API | Node.js + **Hono** atau Fastify (alternatif: NestJS), mandiri, di `apps/api` | API berversi `/api/v1`, token, bisa dipakai web, desktop, mobile |
| Validasi | Zod | Skema dipakai bersama klien dan server |
| Antrean kerja | Driver dapat diganti: `db` (antrean di MySQL, default) atau `redis` (BullMQ) | Email, SMS, sinkron, pekerjaan terjadwal; tidak mewajibkan Redis |
| UI web | Next.js (App Router) + React + TypeScript | Back Office dan kasir PWA; hanya lapisan tampilan |
| Styling | Tailwind CSS (properti logis untuk RTL) + komponen sendiri | Cepat, responsif untuk tablet |
| Database | **MySQL 8.4 LTS** (InnoDB, `utf8mb4`) | Transaksi ACID, JSON, window function untuk laporan, mudah dihosting |
| ORM | Drizzle (utama) atau Prisma | Migrasi terversi, tipe aman |
| Auth | Token (JWT akses + refresh) untuk semua klien | Back Office: email + password. Kasir: PIN setelah perangkat didaftarkan |
| Offline kasir | PWA + IndexedDB, lalu SQLite di desktop/mobile + antrean sinkron | Kasir harus tetap jalan saat internet putus |
| Grafik | Recharts atau ECharts | Dashboard |
| Tes | Vitest (unit), Playwright (alur utama) | |

Next.js tidak menjadi tempat logika bisnis: tidak memakai server actions atau route handler untuk aturan inti.
Semua data dan aturan lewat `apps/api`.

Struktur repo (monorepo npm; paket bersama dihubungkan lewat path alias TypeScript, lihat bagian 1e):

```
apps/api/            Server API (Hono/Fastify): /api/v1/*
apps/web/            Next.js: /backoffice/*, /pos/*  (tampilan saja)
packages/db/         skema, migrasi, seed
packages/domain/     aturan bisnis murni (hitung pajak, promo, stok, shift)
docs/
research/
```

Aturan bisnis ditaruh di `packages/domain` tanpa dependensi ke web/DB, agar mudah diuji.

## 1a. Target platform: web, desktop, mobile

Syarat: produk harus berjalan di **web, desktop, dan mobile**. Strategi: satu basis kode UI web,
dibungkus untuk desktop dan mobile, dengan backend dan aturan bisnis yang dipakai bersama.

| Platform | Pembungkus | Dipakai untuk | Fase |
|---|---|---|---|
| Web | Next.js (Back Office) + PWA (kasir) | Semua fitur | 0–8 |
| Desktop | Tauri (alternatif: Electron) | Kasir di PC/kasir Windows, printer USB/serial, laci kas | 10 |
| Mobile | Capacitor (alternatif: React Native/Expo) | Kasir di tablet/HP, printer Bluetooth, scanner kamera | 11 |

Keputusan arsitektur yang menjaga ini tetap murah:

1. **Backend sebagai API terpisah dan berversi** (`/api/v1`) dengan autentikasi **token** (bukan hanya cookie).
   Logika inti tidak boleh bergantung pada fitur khusus Next.js (server actions, middleware).
2. **`packages/domain`** (TypeScript murni) berisi hitung total, promo, stok, shift, loyalty.
   Dipakai web, desktop, mobile, dan server dengan kode yang sama.
3. **Hardware adapter**: satu antarmuka `Hardware { printReceipt, openCashDrawer, scanBarcode, ... }`
   dengan implementasi per platform (Web: `window.print()`/WebUSB; Tauri: USB/serial native;
   Capacitor: Bluetooth). Kode UI hanya memanggil antarmuka ini.
4. **Penyimpanan lokal bertingkat**: IndexedDB (web), SQLite (desktop/mobile) di balik satu lapisan
   `LocalStore`. Protokol sinkron (`/api/sync`, ID klien UUID, idempoten) identik di semua platform.
5. **UI kasir responsif dan ramah sentuh** sejak awal (target tablet 10", HP 6", layar PC), tidak hanya desktop.
6. **Pembaruan aplikasi**: web otomatis; desktop dan mobile lewat updater/toko aplikasi. API harus kompatibel
   mundur untuk beberapa versi karena klien lama tidak langsung diperbarui.
7. **Back Office tetap web saja**. Wrapper desktop/mobile hanya untuk aplikasi kasir.

Struktur repo menyesuaikan:

```
apps/api/            Server API mandiri (Hono/Fastify)
apps/web/            Next.js: /backoffice/*, /pos/*
apps/desktop/        Tauri membungkus /pos
apps/mobile/         Capacitor membungkus /pos
packages/domain/     aturan bisnis murni
packages/i18n/       katalog terjemahan id/en/ar
packages/hardware/   antarmuka + adapter per platform
packages/sync/       LocalStore + antrean sinkron
packages/db/         skema, migrasi, seed
```

Bila nanti mobile memerlukan pengalaman native penuh, UI kasir bisa ditulis ulang dengan React Native
sambil memakai ulang `domain`, `sync`, dan API yang sama. Karena itu tiga paket tersebut tidak boleh
mengimpor apa pun dari React atau browser.

## 1e. Keputusan implementasi Fase 0 (menyimpang dari rencana awal)

| Rencana awal | Kenyataan | Alasan |
|---|---|---|
| pnpm + Turborepo, workspace | **npm**, satu `package.json` di root (API, db, domain, i18n) dan satu di `apps/web`; antar-paket lewat **path alias** tsconfig/vitest | Mesin pengembangan memakai drive **exFAT** yang tidak mendukung symlink dan hardlink, sehingga pnpm dan workspace npm gagal. Cara ini berjalan di semua sistem berkas. Konsekuensi: tidak ada penjadwalan build antarpaket (belum dibutuhkan) |
| Cookie sesi lintas asal | Web memanggil **`/api/v1` pada asal yang sama**; Next meneruskannya ke API (`rewrites`) | Cookie refresh `SameSite=Lax` tidak terkirim antara `localhost` dan `127.0.0.1` (dianggap beda situs) |
| `middleware.ts` | **`proxy.ts`** (nama baru di Next.js 16) | Mengikuti versi Next yang terpasang |
| Password argon2 atau bcrypt | **bcryptjs** (JavaScript murni) | Tanpa modul native, jadi pemasangan tidak bergantung pada kompiler di Windows |
| TypeScript 5.x | **TypeScript 7** | Versi terbaru saat dipasang; opsi `baseUrl` sudah dihapus sehingga alias memakai path relatif |

Perilaku keamanan yang sudah dipasang dan diuji:
- Token akses JWT (HS256) berumur 15 menit berisi daftar hak akses; perubahan peran berlaku paling lambat sebesar umur token.
- Refresh token acak, disimpan sebagai hash SHA-256, **diputar** setiap dipakai. Memakai ulang token lama mencabut seluruh sesi pengguna itu.
- Klien web menerima refresh token hanya lewat cookie `httpOnly`; klien lain lewat body.
- Pembatas percobaan masuk di memori (10 kegagalan per 15 menit per IP+email); perlu diganti penyimpanan bersama bila API dijalankan lebih dari satu instance.
- Login tidak membedakan "email tak dikenal" dari "kata sandi salah", termasuk dari sisi waktu respons.
- Akses data hanya lewat `tenantRepo` (selalu menyaring `business_id` dan baris terhapus). Tes sengaja diuji dengan menghapus penyaring itu: tes isolasi langsung gagal.
- Belum ada: PIN kasir, audit log, pembatasan per perangkat, lint anti-string-literal untuk i18n.

## 1f. Katalog (Fase 1): aturan yang berlaku

- **Uang**: integer satuan terkecil (`bigint`); persen sebagai basis point (10% = 1000). Tidak ada float.
- **Hapus = soft delete** (`deleted_at`). Nama dan SKU hanya unik di antara baris yang belum dihapus (kolom turunan + indeks unik),
  jadi nama bisa dipakai lagi setelah dihapus. Riwayat tidak hilang.
- **Harga per tipe penjualan**: `item_variant_prices` menimpa `base_price` hanya untuk tipe penjualan itu; nilai 0 tetap dianggap harga (gratis).
  Fungsi `priceFor` ada di `packages/domain` dan dipakai server maupun kasir offline.
- **Rujukan lintas bisnis ditolak** (kategori, brand, tipe penjualan, modifier, varian, outlet) dengan galat per bidang, diuji.
- **Pembaruan item**: varian yang dikirim dengan `id` diperbarui, tanpa `id` dibuat, yang tidak disebut dihapus. Varian milik item lain ditolak.
- **Audit**: tabel `audit_logs` hanya ditambah. Setiap perubahan katalog ditulis **dalam transaksi yang sama** dengan perubahannya
  (tidak ada perubahan tanpa jejak). Perubahan harga/modal menandai `priceChanged`.
- **Impor CSV**: kunci pencocokan SKU lalu nama item + nama varian (tidak peka huruf besar). Satu transaksi; satu galat membatalkan semuanya.
  Kolom wajib `name`, `price`; harga harus bilangan bulat satuan terkecil. Ekspor memakai BOM UTF-8 dan menetralkan awalan rumus
  (`= + - @`) agar aman dibuka di Excel. Maksimal 2000 baris per impor.
- **Promo**: aturan lintas bidang divalidasi di server (persen 1-100%, beli-gratis wajib item hadiah, akhir setelah mulai).
  Promo baru disimpan; **penerapannya di keranjang adalah pekerjaan Fase 2**.

### Strategi tes basis data
Skema tes dibuat **sekali per proses** (`apps/api/test/global-setup.ts`: hapus dan buat ulang `*_test`, migrasi, verifikasi InnoDB);
tiap berkas tes membuat dua bisnis baru berlabel acak. Cara lama (membuat ulang database per berkas) menghasilkan tes tidak stabil
karena DDL InnoDB lambat di disk mesin pengembangan. Pengaman: hanya database berakhiran `_test` yang boleh dihapus.

## 1g. Pajak per outlet, PATCH aman, gambar, dan terjemahan

**Harga termasuk pajak atau belum (per outlet).** Kolom `outlets.prices_include_tax`:
- `false` (bawaan, eksklusif): pajak **ditambahkan** di atas harga menu. Harga Rp100.000 dengan pajak 10% dibayar Rp110.000.
- `true` (inklusif): harga menu **sudah termasuk** pajak; pajak **dipisahkan**. Harga Rp110.000 dengan pajak 10% = net Rp100.000 + pajak Rp10.000, dibayar Rp110.000.
`applyTaxes(jumlah, [tarifBp...], inklusif)` di `packages/domain/src/tax.ts` menghitung keduanya: bilangan bulat satuan terkecil, pembulatan
setengah ke atas, **net + pajak selalu sama persis dengan bruto** (diuji untuk 0..5000 pada banyak tarif), beberapa pajak diperlakukan sebagai tarif
gabungan dengan sisa pembulatan di pajak terakhir, dan BigInt dipakai agar nominal sangat besar tidak kehilangan presisi. Server dan kasir (termasuk offline)
memakai fungsi yang sama. Yang masih perlu diputuskan di Fase 2: urutan dengan diskon dan gratuity, serta pembulatan akhir (dikonfirmasi dengan akuntan).

**PATCH tidak boleh menimpa data.** `partial()` milik Zod tetap menerapkan nilai `default()`, sehingga PATCH {name} pernah mengembalikan status,
daftar outlet, modifier, dan mode pajak ke bawaan. Semua rute PATCH memakai `patchSchema` (`apps/api/src/http.ts`) yang membuang nilai bawaan,
dan `apps/api/test/patch-safety.test.ts` memeriksa setiap entitas (diuji dengan mutasi: tes gagal bila `partial()` bawaan dipakai). Pengecualian yang
disengaja: `variants` pada item dikirim utuh dan menggantikan daftar lama.

**Gambar.** `POST /uploads/image` (multipart, hak `library.manage`, maksimal 2 MB). Jenis ditentukan dari **byte awal** berkas (PNG/JPEG/WebP), bukan dari nama
atau header klien; SVG dan lainnya ditolak. Disimpan di `STORAGE_DIR/<business_id>/<uuid>.<ext>`; `GET /files/...` publik dengan nama UUID, `nosniff`, dan CSP
`sandbox`. `items.image_url` hanya boleh berupa gambar unggahan bisnis itu sendiri (URL luar dan gambar bisnis lain ditolak). Folder `storage/` ikut dicadangkan bersama database.

**Terjemahan.** Tabel `translations(entity_type, entity_id, locale, field, value)`; `PUT/GET /translations/:entityType/:entityId` dan
`GET /translations?entityType&locale` (massal untuk kasir). Jenis: item, kategori, brand, set modifier, bundle, promo, tipe penjualan. Perubahan diaudit.

**Outlet baru.** `POST /outlets` dengan `assignCatalog` (bawaan `true`) menyediakan seluruh katalog di outlet itu dalam transaksi yang sama.

## 1h. Mesin hitung pesanan, promo, pembayaran, pisah bill, shift (Fase 2, bagian murni)

Semua di `packages/domain` (TypeScript murni, tanpa DB/UI): server dan kasir offline memakai kode yang sama. Diuji 124 tes unit,
termasuk sapuan 144.576 kombinasi pengaturan dan harga untuk mesin hitung.

**Urutan hitung (`computeOrder`)** dan pengaturan per outlet:
1. Harga baris = harga satuan (sudah termasuk modifier) x jumlah.
2. Diskon baris (persen/nominal), lalu diskon promo otomatis (`applyPromos`), lalu diskon pesanan. Hasilnya B (harga setelah diskon).
3. Dari B diturunkan N (nilai barang sebelum pajak dan service charge). Service charge G = g x N; pajak barang = t x N;
   pajak atas service charge = t x G (bila `taxOnGratuity`).
4. Komponen yang "sudah termasuk" di harga menu dipisahkan dari B; yang tidak termasuk ditambahkan di atas B (`addedOnTop`).
5. Pembulatan akhir ke kelipatan `roundingStep` (terdekat/ke atas/ke bawah), dicatat terpisah sebagai `rounding`.

| Pengaturan | Bawaan | Arti |
|---|---|---|
| `pricesIncludeTax` | tidak (sudah ada di `outlets`) | pajak dipisahkan dari harga menu |
| `pricesIncludeGratuity` | tidak | service charge dipisahkan dari harga menu |
| `taxOnGratuity` | ya | pajak juga dikenakan atas service charge |
| `roundingStep`, `roundingMode` | 0 (mati), terdekat | pembulatan total; rupiah biasanya 100 |

Contoh (B = Rp100.000, service 5%, pajak 10% atas harga dan service): total eksklusif = Rp115.500; bila harga sudah termasuk pajak dan service
(menu Rp115.500) pelanggan membayar tepat Rp115.500 dan komponennya dipisahkan. Sifat yang selalu benar dan diuji: total = N + G + pajak, bagian di
dalam harga menu = B, tidak ada komponen negatif, harga lebih tinggi tidak pernah menghasilkan total lebih rendah, selisih pembulatan komponen
tertanam paling banyak 2 satuan terkecil.

> **KEPUTUSAN (pemilik produk, 15 Okt 2026)**: urutan dasar diskon → service charge → pajak → pembulatan **dipakai** sebagai keputusan sementara,
> diserahkan kepada saya untuk ditetapkan. Yang tetap perlu dicek akuntan sebelum uang sungguhan diproses: (b) pajak dikenakan atas service
> charge; (c) service charge dihitung dari nilai barang sebelum pajak. Keduanya sudah bisa diatur per outlet (`taxOnGratuity`, `pricesIncludeGratuity`);
> hanya urutan dasar yang tetap.

**Lingkup dan penggabungan diskon (diputuskan 15 Okt 2026).**
- *Lingkup* (`discounts.scope`): **umum** (`order`) hanya untuk seluruh pesanan; **item** (`item`) hanya untuk item atau kategori sasarannya
  (`discount_items`, `discount_categories`). Diskon item wajib punya sasaran; diskon umum tidak boleh. Server menolak diskon yang dipakai di tempat
  yang salah (diskon umum di baris, diskon item di item lain atau di pesanan, diskon item di paket/bundle). Promo otomatis sudah per item/kategori.
- *Penggabungan* (`outlets.discount_mode`, per outlet): **berurutan** (bawaan): diskon baris, lalu promo, lalu diskon pesanan, masing-masing dari sisa harga;
  **kombinasi**: semua diskon persen dihitung dari harga awal lalu dijumlahkan, tidak melebihi harga; **salah satu**: satu baris hanya menerima satu
  diskon (yang terbesar antara diskon baris dan promo; seri memilih diskon baris), dan diskon pesanan hanya berlaku untuk baris yang belum berdiskon.
  Bagian diskon pesanan dibagi ke baris sebanding sisa harga (`orderDiscountShare`, jumlah tepat). Diuji dengan contoh tangan dan sapuan lebih dari 1.500 kombinasi.

**Promo (`applyPromos`).** Satu unit hanya menerima satu promo (berurutan sesuai daftar). Diskon persen: bila syarat jumlah terpenuhi, **semua** unit yang
memenuhi syarat didiskon ("beli minimal N"); dengan `multiple`, hanya kelompok penuh. Diskon nominal: sekali, atau per kelipatan. Beli X gratis Y:
unit hadiah **termurah** yang digratiskan, dibatasi stok hadiah di keranjang; bila hadiah juga memenuhi syarat (beli 2 gratis 1 item sama),
unit gratis tidak dihitung sebagai syarat. Jadwal (tanggal, jam, hari) dihitung di **zona waktu outlet**, termasuk jendela lewat tengah malam;
tipe penjualan dan outlet menyaring promo. Aturan ini adalah penafsiran saya atas deskripsi produk acuan dan perlu disetujui pemilik toko.

**Pembayaran (`settle`).** Pisah bayar banyak metode; kembalian hanya dari tunai; non-tunai tidak boleh melebihi sisa; tunai untuk tagihan yang sudah
lunas ditolak; pembayaran sebagian diizinkan. **Pisah bill (`splitLines`)**: diskon nominal dibagi sebanding dengan jumlah tepat (sisa ke bagian
tertinggal), diskon persen ikut, promo dihitung ulang setelah dipisah. **Kas shift**: diharapkan = modal + tunai bersih - refund tunai + kas masuk - kas keluar.
**PIN**: 4-6 digit, PIN lemah (0000, 1234, 1212) ditolak, penguncian setelah 5 kesalahan (30 detik, berlipat dua, maksimal 30 menit).

## 1b. Perangkat keras yang didukung

Standar: **ESC/POS** (printer thermal). Semua perangkat di bawah dicapai lewat antarmuka `Hardware`
(bagian 1a), sehingga mengganti model tidak mengubah kode aplikasi.

### Printer struk dan tiket pesanan

| Kebutuhan | Spesifikasi | Contoh model (referensi, belum diuji) | Koneksi |
|---|---|---|---|
| Kasir desktop (meja tetap) | 80 mm, auto-cutter, port laci kas (RJ11) | Epson TM-T82X, Xprinter XP-N160II | USB |
| Tablet Android, portabel | 58 mm | tipe RPP02N (terlihat di tutorial), Xprinter XP-P300 | Bluetooth |
| iPad / iOS | 80 mm | printer berbasis LAN apa pun yang mendukung ESC/POS | LAN / Wi-Fi |
| Dapur atau bar (tiket pesanan) | 80 mm, tahan panas dan percikan | sama dengan kasir desktop | LAN |
| Label stiker (opsional) | label thermal | Epson TM-T82, Star TSP650II (disebut di tutorial) | USB / LAN |

Aturan pemilihan:
- Pilih yang **mendukung ESC/POS langsung**; hindari printer yang hanya jalan dengan driver Windows khusus.
- **iOS tidak mendukung Bluetooth klasik** yang dipakai printer murah; pakai LAN atau Wi-Fi.
- Beli **satu unit untuk diuji** per model; kodepage dan pemotong kertas bisa berbeda antar merek.
- **Cetak bahasa Arab**: banyak printer ESC/POS tidak mendukung penyambungan huruf dan RTL, jadi struk Arab dirender sebagai gambar (lihat bagian 1c). Uji model printer dengan struk Arab sebelum membeli banyak.
- Harga dan ketersediaan di Indonesia belum diverifikasi; cek ke toko sebelum membeli.

### Perangkat lain

| Perangkat | Fungsi | Cara terhubung | Catatan |
|---|---|---|---|
| Laci kas (cash drawer) | Terbuka saat bayar tunai | Dipicu lewat port RJ11 printer (perintah ESC/POS) | Tidak perlu koneksi sendiri |
| Barcode scanner | Cari item cepat | USB/Bluetooth mode keyboard (HID) | Berfungsi di semua platform tanpa kode khusus |
| Scanner kamera | Cadangan di HP/tablet | Kamera perangkat | Mobile saja |
| Customer display | Menampilkan keranjang ke pelanggan | Layar kedua / tablet kedua via jaringan | Fase lanjutan |
| EDC / mesin kartu | Pembayaran kartu | Integrasi vendor | Di luar versi 1 |

### Dukungan per platform

| Kemampuan | Web (PWA) | Desktop (Tauri) | Mobile (Capacitor) |
|---|---|---|---|
| Cetak lewat dialog sistem | Ya | Ya | Terbatas |
| Cetak ESC/POS langsung USB/serial | Chrome (WebUSB/WebSerial) | Ya | Tidak |
| Cetak ESC/POS Bluetooth | Terbatas (hanya BLE) | Ya | Android ya; iOS tidak |
| Cetak ESC/POS LAN | Lewat server relay | Ya | Ya |
| Buka laci kas | Lewat printer | Ya | Ya |
| Scanner HID | Ya | Ya | Ya |

Konsekuensi: kasir web murni hanya cocok untuk cetak lewat dialog atau Chrome dengan USB.
Untuk printer nyata yang andal, gunakan wrapper desktop atau mobile, atau server relay LAN.

## 1c. Multi-bahasa (Indonesia, Inggris, Arab) dan RTL

Locale yang didukung: `id` (default), `en`, `ar`. Locale dipilih per pengguna (`users.locale`), dengan
default per bisnis (`businesses.default_locale`). Aplikasi kasir mengikuti locale karyawan yang login.

**Teks antarmuka**
- Semua string lewat katalog di `packages/i18n` (JSON per locale, kunci per domain, mis. `pos.payment.title`),
  format **ICU MessageFormat**. Bahasa Arab punya enam bentuk jamak (nol, satu, dua, sedikit, banyak, lainnya);
  jangan membuat jamak dengan menambah "s" di kode.
- Pustaka web: next-intl (atau setara). Paket katalog dipakai ulang oleh desktop dan mobile.
- Aturan lint: dilarang string literal di komponen UI. CI gagal bila ada kunci yang belum ada di ketiga bahasa.
- Kunci hilang jatuh ke `en`, lalu `id`. Ada "pseudo-locale" untuk menguji teks panjang dan kunci yang terlewat.
- Glosarium istilah (Bill, Shift, Void, Refund, Outlet, ...) disepakati dulu; terjemahan Arab dan Inggris
  ditinjau penutur asli, tidak hanya terjemahan mesin.

**Tata letak RTL**
- `dir="rtl"` pada bahasa Arab. Gunakan **properti logis CSS** sejak awal (`margin-inline-start`,
  `padding-inline-end`, `inset-inline-start`; di Tailwind `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`).
  Dilarang `left`/`right`/`ml-`/`mr-` pada komponen bersama.
- Sidebar berpindah ke kanan, urutan kolom tabel dan wizard terbalik, ikon berarah (panah, chevron, "kembali")
  dibalik. Ikon non-berarah (logo, tanda centang, jam) tidak dibalik.
- Angka, kode, SKU, URL, dan nomor telepon tetap tampil LTR di dalam teks RTL (gunakan `<bdi>`/`dir="auto"`).
- Grafik: sumbu waktu tetap kiri-ke-kanan, legenda dan tata letak kartu mengikuti RTL.
- Struk dan laporan PDF juga mengikuti locale outlet (`receipt_settings.locale`).

**Format dan data**
- Tanggal, angka, dan mata uang lewat `Intl` per locale. Digit default **Latin (0-9)** untuk semua bahasa agar
  nominal tidak ambigu; opsi per pengguna untuk digit Arab-Indic (٠-٩).
- Mata uang per bisnis (`currency`, `currency_exponent`). Uang disimpan sebagai integer **satuan terkecil**
  (rupiah: 0 desimal; SAR/AED: 2 desimal), bukan float.
- Zona waktu per outlet, awal pekan dapat diatur per bisnis (`week_start`: Sabtu/Minggu/Senin).
  Kalender Hijriah sebagai tampilan opsional di fase lanjutan.
- Pengurutan dan pencarian memakai `Intl.Collator` per locale. Pencarian Arab menormalkan harakat dan
  bentuk alif/ya/ta marbuta (kolom `search_text` ternormalisasi).
- Ekspor CSV memakai UTF-8 dengan BOM agar terbaca di Excel; PDF memakai font Arab yang di-embed.

**Terjemahan data bisnis**
```
translations(id, business_id, entity_type, entity_id, field, locale, value)
```
Untuk nama item, kategori, modifier, bundle, promo, dan teks struk. Bila terjemahan tidak ada,
tampil nama dasar. Menu pelanggan (nanti) memakai locale pelanggan.

**Font**: tumpukan font dengan dukungan Arab (mis. Noto Sans Arabic atau IBM Plex Sans Arabic) di samping
font Latin. Untuk desktop dan mobile, font dibundel agar tetap benar saat offline.

**Cetak Arab**: banyak printer thermal ESC/POS tidak mendukung penyambungan huruf dan arah RTL. Untuk locale `ar`,
struk dirender sebagai **gambar (raster)** lalu dikirim ke printer. Ini lebih lambat dan lebih boros kertas
dibanding cetak teks, jadi uji di perangkat nyata sejak awal.

**Pengujian**: tangkapan layar Playwright dijalankan di `id`, `en`, dan `ar`; daftar periksa RTL
per halaman (kolom tabel, ikon berarah, dialog, dropdown, input angka).

## 1d. Menjalankan dengan atau tanpa Docker

Syarat: seluruh sistem harus bisa dijalankan **dengan Docker maupun tanpa Docker**, baik untuk pengembangan
maupun produksi. Docker hanya kemudahan, tidak boleh menjadi syarat.

**Aturan desain**
1. **Semua konfigurasi lewat variabel lingkungan** (`.env`), tidak ada alamat, port, atau jalur yang ditulis di kode:
   `DATABASE_URL`, `API_PORT`, `WEB_URL`, `JWT_SECRET`, `QUEUE_DRIVER`, `REDIS_URL` (opsional), `STORAGE_DIR`,
   `SMTP_*`. Berkas `.env.example` memuat semuanya beserta nilai contoh.
2. **Tidak ada ketergantungan tersembunyi pada layanan lain.** Satu-satunya layanan eksternal wajib adalah MySQL.
3. **Redis opsional.** `QUEUE_DRIVER=db` (default) memakai tabel antrean di MySQL; `QUEUE_DRIVER=redis` hanya
   dipakai bila beban naik. Dengan begitu pemasangan tanpa Docker (terutama di Windows) tidak perlu Redis.
4. **Penyimpanan berkas** (logo, gambar item) lewat antarmuka `Storage` dengan driver `local` (folder) atau
   `s3` (S3-kompatibel). Tidak memakai volume Docker secara khusus.
5. **Tidak ada skrip yang berasumsi di dalam kontainer**: tidak memakai nama host seperti `db` atau `redis`
   sebagai nilai bawaan; bawaan adalah `127.0.0.1`.
6. **Lintas OS**: skrip memakai Node (bukan bash khusus), supaya sama di Windows, macOS, dan Linux.

**Dua cara pakai**

| | Dengan Docker | Tanpa Docker |
|---|---|---|
| Pengembangan | `docker compose up -d` menjalankan MySQL (dan Redis bila perlu) | Pasang MySQL 8.4 sendiri, salin `.env.example` ke `.env`, isi `DATABASE_URL` |
| Setup awal | `npm run setup` (membuat database, migrasi, seed) | `npm run setup` yang sama |
| Menjalankan | `npm run dev` | `npm run dev` yang sama |
| Produksi | Image `api` dan `web` dari `Dockerfile` | `npm run build`, lalu jalankan dengan pm2 atau systemd di belakang Nginx/Caddy |
| Cadangan | `mysqldump` dari kontainer | `mysqldump` biasa, dijadwalkan dengan cron |

**Berkas yang disediakan**: `docker-compose.yml` (opsional), `Dockerfile` untuk `api` dan `web` (opsional),
`.env.example`, `scripts/setup.mjs`, dan panduan `docs/05-menjalankan-tanpa-docker.md` (ditulis saat fase 0).

**Pemeriksaan**: CI menjalankan tes integrasi dalam dua mode, yaitu MySQL dari service container dan MySQL
terpasang langsung, supaya kedua jalur tidak diam-diam rusak. **Status (14 Okt 2026):** berkas CI baru menguji mode service container dan belum pernah dijalankan; job untuk MySQL terpasang langsung belum ditulis. Jalur tanpa Docker sudah diuji manual di Windows. Perintah `npm run doctor` memeriksa versi Node,
koneksi MySQL, versi MySQL, dan variabel lingkungan yang kurang.

## 2. Multi-tenancy dan outlet

- Setiap tabel data bisnis punya `business_id`. Semua query wajib menyaring `business_id` dari sesi.
- Entitas yang bisa beda per outlet memakai tabel penghubung `*_outlets` atau kolom `outlet_id`.
- Pola "Save to All Outlets" = membuat/menyamakan baris penghubung untuk semua outlet.
- MySQL **tidak punya Row-Level Security**, jadi isolasi bisnis dijaga di lapisan aplikasi: semua akses data lewat
  *tenant-scoped repository* yang otomatis menambahkan `business_id` dari sesi; query mentah dilarang kecuali
  lewat helper yang sama. Tes otomatis wajib mencoba akses lintas bisnis di setiap endpoint.

## 3. Skema database (ringkas)

Konvensi: `id` UUID (disarankan **UUIDv7** disimpan `BINARY(16)` agar indeks tetap berurutan), `created_at`,
`updated_at`, `deleted_at` (soft delete) di semua tabel. Waktu disimpan UTC sebagai `DATETIME(3)`
(bukan `TIMESTAMP`, yang berbatas tahun 2038).
Uang disimpan sebagai **integer satuan terkecil mata uang** (`bigint`, bukan float; rupiah = 0 desimal,
mata uang lain mengikuti `currency_exponent` bisnis). Stok sebagai `DECIMAL(14,3)`.

### 3.0 Catatan khusus MySQL
- **WAJIB InnoDB.** MySQL bawaan sebagian paket (terbukti pada WampServer di mesin pengembangan) memakai **MyISAM**
  sebagai mesin default: tanpa transaksi (rollback tidak berfungsi), tanpa foreign key (diabaikan diam-diam), dan tidak
  tahan crash. Pertahanan berlapis: (1) tiap koneksi aplikasi menjalankan `SET default_storage_engine='InnoDB'`;
  (2) `db:migrate`, startup API, `npm run doctor`, dan tes gagal bila ada tabel non-InnoDB; (3) ada tes yang memeriksa
  foreign key menolak data yatim dan rollback membatalkan perubahan. Temuan ini baru terdeteksi di Fase 1; database
  Fase 0 dibuat ulang. Di server produksi tetap atur `default-storage-engine=InnoDB` di konfigurasi MySQL.
- **Mesin dan karakter**: InnoDB, `utf8mb4` dengan kolasi `utf8mb4_0900_ai_ci` (tidak sensitif aksen/huruf besar).
  Kolasi ini membantu pencarian Arab dengan harakat, tetapi tetap simpan kolom `search_text` ternormalisasi
  dan uji dengan data Arab sungguhan.
- **Soft delete + unik**: indeks unik yang mengabaikan baris terhapus memakai kolom turunan, mis.
  `active_key = IF(deleted_at IS NULL, name, NULL)` dengan indeks unik pada kolom itu.
- **Konsistensi stok**: ubah stok di dalam transaksi dengan `SELECT ... FOR UPDATE` pada baris `stock_levels`;
  pertahankan urutan penguncian yang sama untuk menghindari deadlock, dan sediakan retry otomatis.
- **Idempotensi sinkron**: `INSERT ... ON DUPLICATE KEY UPDATE` pada ID klien.
- **Nomor dokumen** (struk, PO, transfer): tabel `counters(outlet_id, kind, value)` dikunci per baris saat naik.
- **Migrasi**: DDL MySQL tidak transaksional. Buat migrasi kecil, satu perubahan per berkas, dan mudah diulang.
- **Laporan**: window function dan CTE tersedia di MySQL 8; tabel agregat harian dipakai bila query berat.
- **Lingkungan**: MySQL boleh dijalankan lewat Docker maupun terpasang langsung (lihat bagian 1d); versi yang sama di produksi.
- **ORM**: Drizzle dan Prisma sama-sama mendukung MySQL; pilih satu dan uji migrasi sejak fase 0.

### 3.1 Inti
```
businesses(id, name, phone, email, address, province, plan, currency, currency_exponent,
           default_locale, week_start, settings JSON)
outlets(id, business_id, name, address, phone, timezone, status)
users(id, business_id, name, email, phone, password_hash, pin_hash, role_id, locale, status)
user_outlets(user_id, outlet_id)
roles(id, business_id, name, access_type)            -- app_only | backoffice_only | both
role_privileges(role_id, privilege)                  -- privilege = string kunci
devices(id, outlet_id, name, token_hash, last_seen_at)
```

### 3.2 Katalog
```
categories(id, business_id, name)
brands(id, business_id, name)
sales_types(id, business_id, name, status)
items(id, business_id, category_id, brand_id, name, description, image_url, track_stock bool)
item_variants(id, item_id, name, sku, base_price, cost)
item_variant_prices(variant_id, sales_type_id, price)   -- override per sales type
item_outlets(item_id, outlet_id, available bool, favorite_position int)
modifier_sets(id, business_id, name, min_select, max_select, track_stock bool)
modifier_options(id, set_id, name, price)
modifier_option_ingredients(option_id, ingredient_id, quantity)
item_modifier_sets(item_id, set_id)
bundles(id, business_id, name, image_url, price, status)
bundle_items(bundle_id, item_id, variant_id, quantity)
bundle_prices(bundle_id, sales_type_id, price)
bundle_outlets(bundle_id, outlet_id)
```

### 3.3 Harga tambahan
```
taxes(id, business_id, name, rate_bp)               -- rate_bp = basis point (10% = 1000)
gratuities(id, business_id, name, rate_bp)
sales_type_gratuities(sales_type_id, gratuity_id)
tax_outlets / gratuity_outlets(.., outlet_id)
discounts(id, business_id, name, kind, value, customizable bool)  -- kind = percent | amount
discount_outlets(discount_id, outlet_id)
promos(id, business_id, name, type, status, starts_at, ends_at, hours JSON, weekdays JSON, multiple bool)   -- weekdays: array 0-6
promo_requirements(promo_id, scope, item_id, category_id, quantity)
promo_rewards(promo_id, kind, value, item_id, quantity)
promo_outlets(promo_id, outlet_id)
promo_sales_types(promo_id, sales_type_id)
```

### 3.4 Ingredient dan stok
```
units(id, name, abbreviation)
ingredients(id, business_id, name, kind, category, unit_id, avg_cost, alert_at)  -- kind = raw | semi
recipes(id, owner_type, owner_id, variant_id)        -- owner = item | semi_ingredient
recipe_lines(recipe_id, ingredient_id, quantity)
stock_levels(outlet_id, stockable_type, stockable_id, quantity)    -- item_variant | ingredient
stock_movements(id, outlet_id, stockable_type, stockable_id, delta, reason, ref_type, ref_id, unit_cost, at)
suppliers(id, business_id, name, phone, email, address, city, postal_code)
purchase_orders(id, outlet_id, supplier_id, number, status, note, mode, created_by)
purchase_order_lines(po_id, stockable_type, stockable_id, qty_ordered, qty_received, unit_cost)
transfers(id, from_outlet_id, to_outlet_id, number, status, note)
transfer_lines(transfer_id, stockable_type, stockable_id, qty_requested, qty_received)
adjustments(id, outlet_id, note, created_by)
adjustment_lines(adjustment_id, stockable_type, stockable_id, qty_system, qty_actual)
```
`stock_movements` adalah **sumber kebenaran**. `stock_levels` adalah cache yang diperbarui dalam transaksi yang sama.
`reason` = `sale | refund | purchase | transfer_out | transfer_in | adjustment | production`.

### 3.5 Pelanggan dan loyalty
```
customers(id, business_id, name, phone, email, birthday, member_since, points, lifetime_spending)
loyalty_programs(id, business_id, status, earn_type, earn_amount, earn_points, signup_bonus, expires_at, require_sms_code)
loyalty_rewards(id, program_id, points_cost, kind, value, item_id, category_id, max_discount, min_purchase)
loyalty_ledger(id, customer_id, order_id, delta, reason, at)
feedback(id, customer_id, order_id, rating, message, at)
```

### 3.6 Meja
```
table_groups(id, outlet_id, name, status)
tables(id, group_id, name, capacity, x, y, shape)
```

### 3.7 Transaksi
```
orders(id, outlet_id, number, table_id, customer_id, served_by, cashier_id, shift_id,
       sales_type_id, pax, status, opened_at, closed_at,
       subtotal, discount_total, gratuity_total, tax_total, rounding, total, note)
       -- status: open | paid | cancelled | refunded | partially_refunded
order_items(id, order_id, item_id, variant_id, bundle_id, name_snapshot, qty, unit_price,
            sales_type_id, discount_id, discount_amount, note, status)   -- status: active | void
order_item_modifiers(order_item_id, option_id, name_snapshot, price)
order_promos(order_id, promo_id, amount)
payments(id, order_id, method, amount, tendered, change, reference, at)
refunds(id, order_id, reason, amount, by_user_id, at)
refund_lines(refund_id, order_item_id, qty, amount)
invoices(id, outlet_id, customer_id, number, status, due_at, amount)
receipts_outbox(id, order_id, channel, destination, status, at)
```
Nama, harga, dan pajak disimpan sebagai **snapshot** di baris transaksi. Mengubah katalog tidak boleh mengubah riwayat.

### 3.8 Shift dan pengaturan
```
shifts(id, outlet_id, user_id, started_at, ended_at, opening_cash, expected_cash, actual_cash, difference)
cash_movements(id, shift_id, kind, amount, description, at)    -- kind = in | out
payment_configs(id, business_id, name)
payment_config_methods(config_id, method, enabled)
payment_config_outlets(config_id, outlet_id)
receipt_settings(outlet_id, locale, header, footer, logo_url, socials JSON, note)
translations(id, business_id, entity_type, entity_id, field, locale, value)
checkout_settings(business_id, tax_enabled, gratuity_enabled, price_includes_tax, rounding_enabled,
                  rounding_digits, stock_limit, allow_override, track_server, split_payment, save_bill,
                  inventory_mode_po, inventory_mode_transfer, inventory_mode_adjustment)
email_settings(business_id, daily_summary, inventory_alert, promo_update, recipients JSON)
```

## 4. Aturan bisnis penting

### 4.1 Urutan hitung total pesanan
1. `subtotal` = jumlah (harga satuan + modifier) × qty per baris, memakai harga sesuai sales type.
2. Terapkan **promo** (otomatis) lalu **diskon** (manual) per baris atau total.
3. `gratuity` dihitung dari subtotal setelah diskon (atau sebelum, sesuai `checkout_settings`).
4. `tax` dihitung dari subtotal setelah diskon, ditambah gratuity bila diatur demikian.
5. Jika "harga sudah termasuk pajak", pajak dipisah ke bawah, bukan ditambahkan.
6. **Pembulatan** ke digit yang dipilih (mis. ke ribuan terdekat) dicatat di `rounding`.
7. `total = subtotal - discount + gratuity + tax + rounding`.

Fungsi ini murni dan harus punya banyak tes (kombinasi inklusif/eksklusif, diskon %, diskon Rp, promo).

### 4.2 Stok
- Saat order **dibayar**, hasilkan `stock_movements` bertanda `sale`: item biasa mengurangi varian;
  item beresep mengurangi ingredient sesuai resep; modifier bertanda stok mengurangi ingredient opsinya.
- **Refund** menghasilkan gerakan balik (`refund`) hanya bila item dikembalikan ke stok.
- **Stock limit**: bila aktif dan stok ≤ 0, item tidak bisa dijual, kecuali `allow_override`.
- **Biaya rata-rata** ingredient: `(stok_lama × biaya_lama + qty_masuk × biaya_masuk) / (stok_lama + qty_masuk)`.
- **COGS** baris = jumlah biaya ingredient dalam resep × qty, dibekukan saat transaksi.
- **Produce** semi-finished: kurangi bahan mentah sesuai resep, tambah stok semi-finished, hitung biaya rata-rata barunya.

### 4.3 Purchase order, transfer, adjustment
- Mode **Simple**: dibuat = langsung selesai, stok langsung berubah.
- Mode **Advanced**: `draft → waiting_approval → approved → fulfilling → completed` (PO) dan
  `draft → approved → shipped → received` (transfer). Stok berubah saat diterima. Mendukung penerimaan sebagian.
- Adjustment: `delta = actual - system`. Nilai selisih (expense/income) memakai biaya rata-rata.

### 4.4 Shift
- `expected_cash = opening_cash + pembayaran tunai - kembalian + kas masuk - kas keluar - refund tunai`.
- `difference = actual_cash - expected_cash`. Satu kasir hanya boleh punya satu shift terbuka per outlet.
- Transaksi tanpa shift terbuka ditolak (kecuali shift otomatis aktif).

### 4.5 Loyalty
- Poin didapat saat order dibayar. Redeem membuat diskon pada order dan baris negatif di `loyalty_ledger`.
- Bila `require_sms_code`, redeem butuh kode 6 digit (di v1 kode dibaca dari `receipts_outbox`/log).

### 4.6 Nomor dokumen
Nomor struk, PO, transfer unik per outlet dan berurutan, dibuat di server dalam transaksi database.

## 5. Offline kasir

- Kasir memakai Service Worker + IndexedDB untuk katalog, harga, meja, pelanggan ringkas, dan bill terbuka.
- Transaksi baru dibuat di perangkat dengan **ID klien (UUID)** dan masuk antrean `pending_ops`.
- Sinkron: kirim antrean berurutan ke `/api/sync`, server idempoten berdasarkan ID klien.
- Konflik stok diselesaikan di server (stok boleh minus bila aturan stock limit mengizinkan).
- Indikator "Sync" per bill (seperti di Daftar Bill).
- v1: boleh dimulai online-only, tetapi model data dan ID harus sudah siap untuk offline.

## 6. API

REST sederhana di `/api/v1`, dilindungi sesi. Pola umum:
`GET /resources?outlet_id&from&to&q&page`, `POST`, `PATCH /:id`, `DELETE /:id`.
Endpoint khusus: `/orders/:id/pay`, `/orders/:id/split`, `/orders/:id/refund`, `/shifts/:id/close`,
`/inventory/summary`, `/purchase-orders/:id/fulfill`, `/reports/*`, `/sync`.
Validasi input dengan Zod di sisi server. Respons error seragam `{ code, message, fields }`.

## 7. Keamanan

- Password di-hash (argon2/bcrypt). PIN di-hash dan dibatasi percobaan.
- Otorisasi per privilege di setiap endpoint, bukan hanya di UI.
- Semua query disaring `business_id`. Uji penetrasi dasar untuk akses lintas bisnis.
- Audit log untuk void, refund, adjustment, ubah harga.
- Token perangkat kasir dapat dicabut dari Back Office.

## 8. Laporan

Mulai dengan query langsung ke `orders`/`order_items`/`payments`. Bila lambat, tambahkan tabel agregat harian
`daily_sales(outlet_id, date, ...)` yang diisi saat order ditutup. Semua laporan memakai zona waktu outlet.
Definisi angka: **Gross Sales** = subtotal sebelum diskon; **Net Sales** = gross − diskon − refund;
**Gross Profit** = net − COGS; **Total Collected** = net + gratuity + pajak + pembulatan.

**Yang diimplementasikan (Fase 4).** Gross Sales = subtotal; Discounts = diskon baris + promo + diskon pesanan; *Included tax/service* = base − net (bukan nol hanya bila harga menu sudah memuat pajak/service,
sehingga Gross − Discounts − Included = nilai barang bersih); Net Sales = net pesanan − bagian nilai barang dari refund (refund menyimpan rincian net/service/pajak: `refunds.net_amount`,
`gratuity_amount`, `tax_amount`, jumlahnya tepat sama dengan refund); Total Collected = total pesanan − total refund, sehingga **Net + Service + Pajak + Pembulatan = Total Collected** selalu berlaku.
Transaksi dikelompokkan menurut waktu bayar, refund menurut waktu refund, keduanya dalam zona waktu outlet. Nilai barang per baris (laporan item) = net pesanan dibagi ke baris sebanding harga
setelah diskon (jumlah tepat). COGS = modal varian yang dibekukan x jumlah terjual dikurangi yang di-refund.
