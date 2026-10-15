# 03. Roadmap Pembangunan

Urutan dibuat agar setiap fase menghasilkan sesuatu yang bisa dicoba. Estimasi memakai satuan "sesi kerja"
(satu sesi = satu putaran kerja dengan saya, kira-kira satu modul kecil sampai selesai dan teruji).
Angkanya kasar, bukan janji.

## Fase 0. Fondasi (2–3 sesi) — INTI SELESAI 14 Okt 2026, ada sisa

**Sudah berjalan dan teruji**: login Back Office, CRUD outlet dan karyawan, pengalih bahasa Indonesia/Inggris/Arab
dengan RTL, MySQL + migrasi + seed, skrip `setup`/`doctor`/`dev`, 42 tes otomatis (termasuk isolasi antar bisnis dan
hak akses), build produksi, dan `npm run setup` dari repo bersih (diuji di NTFS dan exFAT). Diverifikasi di browser
untuk tiga bahasa.

**Belum dikerjakan dari daftar Fase 0** (jangan dianggap selesai):
- Pemilih outlet di header Back Office.
- Lint (termasuk aturan anti-string-literal i18n) dan formatter; pseudo-locale untuk uji teks panjang.
- Driver antrean `db` dan `redis` (baru ada variabel konfigurasi; belum ada pekerjaan yang memerlukannya).
- Jalur **Docker** (`docker-compose.yml`, Dockerfile) sudah ditulis tetapi **belum pernah dijalankan**; CI belum pernah dijalankan,
  dan job "MySQL terpasang langsung" belum ada.
- Pengujian di Linux dan macOS; pencarian Arab berharakat terhadap kolasi MySQL.

Penyimpangan dari rencana dan alasannya: doc 02 bagian 1e.

- Repo monorepo (npm, path alias; bukan pnpm/Turborepo karena drive exFAT), TypeScript, format, CI sederhana (belum dijalankan). Lint (belum).
- Server API mandiri (`apps/api`, Hono/Fastify): `/api/v1`, auth token, validasi Zod, format error seragam.
  Next.js (`apps/web`) hanya sebagai tampilan yang memanggil API.
- MySQL 8.4 lokal (**boleh dengan Docker atau terpasang langsung**, lihat doc 02 bagian 1d), `.env.example`,
  `npm run setup` dan `npm run doctor`, antrean driver `db` (Redis opsional; antrean belum dibuat karena belum ada pekerjaan), migrasi, seed data demo (satu bisnis, dua outlet, dua pengguna; item dan meja ikut fase 1 dan 3).
- Auth Back Office, tabel bisnis/outlet/user/role, pemilih outlet di header.
- Layout Back Office (sidebar, tabel master-detail, modal pilih item, toast, dialog konfirmasi).
- **i18n dan RTL sejak awal**: katalog terjemahan `id`/`en`/`ar`, lint anti-string-literal, properti CSS logis,
  pengalih bahasa, font Arab, pseudo-locale. Mengerjakan RTL belakangan jauh lebih mahal.
- Panduan `docs/05-menjalankan-tanpa-docker.md` dan CI yang menguji kedua mode.
- **Selesai bila** (tanpa Docker: terpenuhi; dengan Docker: belum diuji): pengembang baru bisa menjalankan sistem dengan Docker **dan** tanpa Docker dari repo bersih; login, ganti outlet, CRUD outlet dan karyawan dasar berjalan, dan halaman tersebut tampil benar di `id`, `en`, dan `ar` (RTL).

## Fase 1. Katalog (3–4 sesi) — SELESAI 14 Okt 2026 (dengan catatan di bawah)

**Berjalan dan teruji** (API, tampilan, tiga bahasa, RTL diverifikasi di browser; 136 tes otomatis + 44 pemeriksaan browser):
- Kategori, brand, tipe penjualan (Dine In dan Take Away bawaan), pajak, gratuity (ditautkan ke tipe penjualan), diskon (persen atau nominal).
- Item dengan varian, SKU unik per bisnis, modal, harga dasar, **harga per tipe penjualan**, modifier, ketersediaan per outlet, **gambar** (unggah, diperiksa dari isi berkas), dan **terjemahan nama/deskripsi** per bahasa.
- Modifier (batas pilihan min/maks), bundle (komponen varian, harga per tipe penjualan), promo lewat **wizard 4 langkah** (diskon per item dan beli X gratis Y; jadwal tanggal, jam, hari; kelipatan).
- **Harga termasuk pajak atau belum, diatur per outlet** (`outlets.prices_include_tax`), karena tiap toko berbeda. Perubahannya diaudit dan memunculkan peringatan. Fungsi hitung pajak murni (`applyTaxes`, eksklusif dan inklusif, beberapa tarif, aritmetika BigInt) sudah ada dan teruji; kasir memakainya di Fase 2.
- **Outlet baru otomatis memperoleh seluruh katalog** (item, bundle, promo, pajak, gratuity, diskon), bisa dimatikan.
- Impor/ekspor CSV item, termasuk kolom `modifiers` dan `track_stock`: semua-atau-tidak-sama-sekali, pemeriksaan dulu, laporan per baris.
- **Jejak audit** untuk setiap perubahan (katalog, outlet, terjemahan) beserta **penampil** (hanya baca, untuk yang berhak `settings.manage`); perubahan harga dan mode pajak ditandai.
- Isolasi antar bisnis dan hak akses diuji untuk setiap entitas, termasuk tampilan peran investor di browser.
- **PATCH aman**: setiap pembaruan sebagian hanya mengubah bidang yang dikirim (lihat doc 02, bagian 1g).

**Catatan dan batas** (jangan dianggap ada):
- Promo dan diskon baru **disimpan**, belum **diterapkan** ke keranjang; mesin penerapan, urutan diskon, gratuity, pajak, dan pembulatan ada di Fase 2.
- Gambar hanya driver `local` (folder `storage/`, harus ikut dicadangkan); belum ada S3, pengecilan ukuran, atau pembersihan gambar yatim.
- Terjemahan tersedia di formulir item, kategori, brand, tipe penjualan, modifier (nama set), dan bundle. Belum untuk nama opsi modifier, promo, diskon, dan pajak, dan belum dipakai kasir.
- Impor CSV tidak mencakup gambar, ketersediaan per outlet, atau terjemahan.
- Mode pajak diatur per outlet; belum ada nilai bawaan tingkat bisnis (outlet baru mulai dari "pajak ditambahkan").
- Penampil audit hanya membaca (tanpa ekspor, tanpa kebijakan retensi).

## Fase 2. Kasir inti (4–5 sesi) — SEDANG BERJALAN (14–15 Okt 2026)

**Selesai dan teruji (bagian murni, tanpa database; 116 tes unit):**
- Mesin hitung total (`computeOrder`): diskon berlapis, service charge, pajak eksklusif/inklusif, pajak atas service, pembulatan; semua per pengaturan outlet.
- Mesin promo (`applyPromos`): diskon per item, beli X gratis Y, jadwal di zona waktu outlet, satu unit satu promo.
- Penyelesaian pembayaran (`settle`), pisah bill (`splitLines`), rekonsiliasi kas shift, kebijakan PIN dan penguncian.
- Aturan lengkap dan asumsi yang belum dikonfirmasi: doc 02 bagian 1h.

**Belum dikerjakan (butuh database yang berjalan untuk dibuktikan):**
- Pengaturan outlet baru di database (`pricesIncludeGratuity`, `taxOnGratuity`, `roundingStep`, `roundingMode`) beserta formulirnya.
- Skema dan API: perangkat dan login PIN, pesanan/bill, pembayaran, nomor struk berurutan tanpa celah, shift dan kas masuk/keluar, struk.
- Tampilan kasir tablet (Favorit/Library/Custom, keranjang, dialog item, bayar, daftar bill, pisah bill, shift).
- Pengisian "outbox" struk (email/SMS) dan cetak.

**Selesai bila**: satu hari penjualan bisa disimulasikan dari buka sampai tutup shift (belum tercapai).

## Fase 3. Meja dan aktivitas (2–3 sesi)
- Table group, table map (Back Office), denah di kasir, mulai bill dari meja.
- Aktivitas, refund, kirim ulang struk, pembatalan bill/produk.
- **Selesai bila**: alur dine-in lengkap termasuk refund berjalan.

## Fase 4. Laporan dan dashboard (3–4 sesi)
- Dashboard (Summary dan Outlet Comparison).
- Sales (semua sub-laporan), Transactions, Invoices, Shift, Table Report.
- Export CSV.
- **Selesai bila**: angka laporan cocok dengan data uji dan dihitung dengan rumus di doc 02 bagian 8.

## Fase 5. Stok dan ingredient (4–5 sesi)
- Stock level + movement, pengurangan saat jual, stock limit.
- Ingredient raw/semi-finished, resep, produce, biaya rata-rata, COGS.
- Supplier, PO (Simple lalu Advanced), transfer, adjustment, inventory summary.
- Modifier stock.
- **Selesai bila**: tes alur stok (jual, refund, PO, transfer, adjustment) lulus semua.

## Fase 6. Pelanggan dan loyalty (2–3 sesi)
- Customer list, tambah pelanggan di kasir, feedback.
- Loyalty program (wizard), poin, reward, redeem di kasir, kode validasi (via log).
- **Selesai bila**: pelanggan baru mendaftar, mengumpulkan poin, lalu menukar reward.

## Fase 7. Pengaturan dan hak akses (2–3 sesi)
- Role dan privilege penuh, PIN access, kuota slot.
- Checkout settings, receipt designer + preview, payment configuration, email notification, inventory mode.
- Penegakan privilege di API dan UI.
- **Selesai bila**: role Cashier tidak bisa membuka Back Office atau refund tanpa izin.

## Fase 8. Offline, PWA, dan kerapian (3–4 sesi)
- Service Worker, IndexedDB, antrean sinkron, indikator sync.
- Responsif tablet, mode layar penuh, uji perangkat nyata.
- Audit log, rate limit PIN, backup database.
- **Selesai bila**: kasir bisa menjual 20 transaksi tanpa internet lalu sinkron tanpa duplikat.

## Fase 9 (opsional). Integrasi
Moka Order-style storefront, integrasi pembayaran sungguhan, GoFood/GrabFood, SMS/email nyata, printer ESC/POS.

## Fase 10. Desktop (2–3 sesi)
- Bungkus kasir dengan Tauri: jendela layar penuh, auto-start, pembaruan otomatis.
- Adapter hardware: printer struk USB/serial (ESC/POS), laci kas, scanner USB.
- `LocalStore` berbasis SQLite untuk offline.
- **Selesai bila**: installer Windows menjalankan kasir, mencetak struk ke printer nyata, dan sinkron setelah offline.

## Fase 11. Mobile (3–4 sesi)
- Bungkus kasir dengan Capacitor untuk Android (iOS menyusul bila diperlukan).
- Adapter hardware: printer Bluetooth, scanner kamera, notifikasi pesanan.
- `LocalStore` SQLite, mode layar penuh, orientasi tablet dan HP.
- Distribusi: APK internal, lalu toko aplikasi.
- **Selesai bila**: tablet Android menjual tanpa internet, mencetak via Bluetooth, dan sinkron tanpa duplikat.

Catatan: fase 10 dan 11 hanya efisien bila aturan di doc 02 bagian 1a dipatuhi sejak fase 0
(API token, paket `domain`/`sync`/`hardware` bebas dari React dan browser).

## Urutan ringkas

```
0 Fondasi → 1 Katalog → 2 Kasir inti → 3 Meja → 4 Laporan → 5 Stok → 6 Loyalty → 7 Pengaturan → 8 Offline
                                                                                              ↓
                                                                                  10 Desktop · 11 Mobile
```
Fase 4 dan 5 bisa ditukar bila stok lebih penting daripada laporan.

## Aturan lintas fase: bahasa
- Definisi selesai tiap fase: semua string baru ada di tiga bahasa dan layar baru lolos daftar periksa RTL.
- Fase 2 (kasir) dan fase 8: uji struk Arab (raster) di printer nyata.
- Perkiraan tambahan biaya bila disiplin ini dijalankan sejak fase 0: sekitar 3–5 sesi total (terjemahan, tinjauan RTL,
  struk Arab). Bila baru dimulai belakangan, biayanya jauh lebih besar karena banyak komponen harus ditulis ulang.

## Syarat bisnis nyata (diputuskan 14 Okt 2026)

Karena Naqdi akan dipakai untuk bisnis sungguhan, hal berikut menjadi **syarat sebelum dipakai di toko**, bukan pilihan.
Status per 14 Okt 2026:

| Syarat | Status | Fase |
|---|---|---|
| Transaksi dan foreign key berfungsi (InnoDB dipaksa dan diverifikasi) | Selesai | 1 |
| Isolasi data antar bisnis, diuji | Selesai | 0–1 |
| Jejak audit perubahan katalog, outlet, terjemahan, dan penampilnya | Selesai (penampil hanya baca) | 1 |
| Jejak audit void, refund, adjustment, ubah peran | Belum | 2–7 |
| Kata sandi di-hash, token berumur pendek, pembatasan login | Selesai | 0 |
| Login PIN kasir dengan penguncian setelah salah berulang, pendaftaran perangkat | Belum | 2 |
| Cadangan database terjadwal dan **uji pemulihan** | Belum (hanya contoh `mysqldump` di doc 05) | 8 |
| HTTPS dan proxy balik; rahasia produksi di luar repo | Panduan ada, belum diuji di server | 8 |
| Pemantauan (log terstruktur, pemberitahuan galat, ruang disk) | Belum | 8 |
| Mode offline dan sinkron tanpa duplikat | Belum | 8 |
| Pengaturan harga termasuk pajak per outlet dan fungsi hitung pajak (eksklusif/inklusif) | Selesai, teruji | 1 |
| Penghitungan pajak/gratuity/pembulatan di keranjang sesuai aturan setempat, diverifikasi dengan akuntan | Belum | 2 |
| Pembaruan sebagian (PATCH) tidak menimpa data lain | Selesai, ada tes regresi | 1 |
| Struk memenuhi ketentuan setempat (NPWP, nomor struk berurutan tanpa celah) | Belum | 2 |
| Pembayaran digital sungguhan (QRIS/e-wallet) lewat penyedia berizin | Belum; saat ini simulasi | 9 |
| Perlindungan data pribadi pelanggan (UU PDP): persetujuan, hak hapus, retensi | Belum | 6–7 |
| Ketentuan layanan, kebijakan privasi, dan rencana dukungan | Belum | di luar kode |
| Uji beban dan uji keamanan oleh pihak yang tidak menulis kodenya | Belum | 8 |

Tidak ada transaksi uang sungguhan yang boleh diproses sebelum baris "penghitungan", "struk", dan "cadangan dan pemulihan" selesai.

## Strategi pengujian
- **Unit**: mesin hitung total, promo, biaya rata-rata, shift, loyalty. Wajib sebelum UI dibuat.
- **Integrasi**: alur stok dan laporan terhadap MySQL uji.
- **E2E (Playwright)**: login, buat item, jual, bayar, refund, tutup shift, cek dashboard; dijalankan juga di locale `ar`.
- **Data uji**: seed deterministik agar angka laporan bisa dicek tangan.

## Risiko dan cara menghadapinya

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Aturan pajak/pembulatan/promo ganda rumit | Total salah | Mesin hitung murni + tes banyak kasus sejak fase 2 |
| Multi-outlet membuat query rumit | Data bocor lintas bisnis | `business_id` wajib lewat repository ber-tenant (MySQL tanpa RLS), tes akses lintas bisnis |
| Offline dan sinkron | Duplikat atau stok salah | ID klien idempoten, mulai online-only tetapi data siap offline |
| Cakupan terlalu luas | Tidak selesai | Kerjakan per fase, stub integrasi eksternal |
| RTL dan Arab ditambahkan terlambat | Banyak komponen ditulis ulang | Properti CSS logis dan katalog terjemahan wajib sejak fase 0 |
| Struk Arab di printer thermal | Huruf terpotong atau terbalik | Render raster, uji model printer lebih awal |
| Detail tutorial tidak lengkap | Salah paham perilaku | Tandai asumsi, cek ulang dengan akun demo bila tersedia |

## Pertanyaan yang masih terbuka

1. ~~Stack~~: **diputuskan**, full TypeScript (Node API mandiri + Next.js + MySQL), tanpa PHP/Laravel.
2. ~~Bahasa antarmuka~~: **diputuskan**, Indonesia (default), Inggris, dan Arab (RTL).
3. ~~Tujuan~~: **diputuskan**, untuk bisnis nyata. Konsekuensinya ada di bagian "Syarat bisnis nyata" di bawah.
4. **Identitas visual** Naqdi (logo, warna). Nama produk sudah diputuskan: Naqdi.
5. **Hukum dan pajak**: aturan pajak daerah, struk, dan perlindungan data pribadi perlu dikonfirmasi dengan konsultan
   sebelum dipakai di toko sungguhan (lihat daftar di bawah).
