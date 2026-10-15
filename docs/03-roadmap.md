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

## Fase 2. Kasir inti (4–5 sesi) — SELESAI UNTUK ALUR UTAMA 15 Okt 2026 (dengan batas di bawah)

**Berjalan dan teruji** (pada akhir Fase 2: 249 tes otomatis; 23 pemeriksaan di browser sungguhan):
- Mesin hitung total (`computeOrder`): diskon berlapis, service charge, pajak eksklusif/inklusif, pajak atas service, pembulatan; semua per pengaturan outlet (`pricesIncludeTax`, `pricesIncludeGratuity`, `taxOnGratuity`, `roundingStep`, `roundingMode`), kini juga diatur di formulir outlet.
- Mesin promo (`applyPromos`), penyelesaian pembayaran (`settle`), pisah bill (`splitLines`), rekonsiliasi kas shift, kebijakan PIN.
- **Perangkat kasir**: didaftarkan dari Back Office (kode aktivasi 8 karakter, berlaku 15 menit, sekali pakai), memakai token perangkat; dicabut atau dipasangkan ulang langsung memutus perangkat lama. Aktivasi dibatasi laju.
- **Login PIN**: PIN 4–6 angka (PIN lemah ditolak), per-pengguna penguncian bertahap, waktu respons tidak membedakan "pengguna tidak ada" dari "PIN salah". Token kasir (`kind: pos`) terikat ke satu outlet dan satu perangkat, dan **tidak diterima** di API Back Office (sebaliknya juga).
- **Harga selalu dihitung server dari katalog**; klien hanya mengirim id, jumlah, pilihan modifier, dan pilihan diskon (tidak ada harga yang bisa disuntik). Aturan modifier (min/maks), ketersediaan per outlet, dan hak `pos.discount` ditegakkan.
- Bill: simpan, ubah isi, batalkan (bill belum dibayar), daftar bill terbuka lintas kasir di outlet, **pisah bill** (jumlah kedua bill selalu sama dengan bill asal).
- Pembayaran: tunai/kartu/QRIS/e-wallet/transfer, **pisah bayar**, kembalian hanya dari tunai, nomor struk **berurutan tanpa celah per outlet** (diuji dengan 6 pembayaran paralel), bayar dua kali ditolak.
- Shift: buka, kas masuk/keluar (laci tidak boleh minus), tutup dengan selisih; satu shift terbuka per kasir per outlet; shift yang masih terbuka dilanjutkan saat kasir login lagi.
- Tampilan kasir tablet: aktivasi, PIN pad, buka shift, katalog (kategori, cari), dialog item (varian, modifier, catatan), keranjang, diskon, bayar (cepat, pisah), struk (cetak lewat dialog cetak browser), bill, pisah bill, shift. Tiga bahasa, RTL diverifikasi.
- Back Office: halaman **Perangkat Kasir**, kolom **PIN** di formulir karyawan, pengaturan checkout baru di outlet.
- Aturan lengkap dan asumsi yang belum dikonfirmasi: doc 02 bagian 1h.

**Catatan dan batas** (jangan dianggap ada):
- Urutan hitung (diskon → service → pajak → pembulatan) **ditetapkan sementara** atas keputusan pemilik produk; pajak atas service charge dan dasar service charge tetap perlu dicek akuntan sebelum uang sungguhan.
- **Diskon**: lingkup umum vs item/kategori, dan mode gabung per outlet (berurutan, kombinasi, salah satu); lihat doc 02 bagian 1h. Arti promo persen ("beli minimal N → semua unit memenuhi syarat didiskon") masih perlu disetujui pemilik toko.
- (Diselesaikan di Fase 3) Bill lunas kini bisa di-refund dan refund tunai masuk hitungan kas shift.
- Tab **Favorit/Custom** belum ada (hanya kategori dan pencarian). Metode pembayaran adalah daftar tetap (belum bisa diatur di Back Office; fase 7).
- Struk dicetak lewat dialog cetak browser. **Belum ada** printer thermal/ESC-POS, laci kas otomatis, atau pengiriman struk email/SMS (tabel `receipt_outbox` sudah ada, belum ada endpoint).
- **Belum offline**: kasir butuh koneksi ke server. Sesi kasir hanya di memori, jadi memuat ulang halaman meminta PIN lagi (perangkat tetap terdaftar).
- Stok belum berkurang saat jual (fase 5); promo dievaluasi saat bill disimpan, bukan saat dibayar (bill yang disimpan sebelum promo berakhir tetap memakai promo itu).
- Diskon pesanan tidak ikut terbawa ke bill baru saat pisah bill; promo dihitung ulang untuk kedua bill.
- Rute kasir belum dibatasi laju selain aktivasi dan login PIN.

**Selesai bila**: satu hari penjualan bisa disimulasikan dari buka sampai tutup shift. Tercapai untuk alur utama (lihat `tools/verify_phase2.mjs`); belum dengan refund, offline, dan printer nyata.

## Fase 3. Meja dan aktivitas — SELESAI 15 Okt 2026 (dengan batas di bawah)

**Berjalan dan teruji** (266 tes otomatis: 130 unit + 136 API; 39 pemeriksaan browser di `tools/verify_phase2.mjs` dan `verify_phase3.mjs`):
- **Grup meja dan meja per outlet** di Back Office (CRUD, nama unik per outlet, diaudit), **denah** dengan geser-dan-simpan (mouse/sentuh), dan hapus meja diblokir bila masih ada bill terbuka.
- **Kasir**: pilih meja dari denah (warna menunjukkan meja berisi bill terbuka beserta totalnya), beberapa bill per meja, pindah meja, bill pisah ikut meja yang sama.
- **Persetujuan atasan**: kasir tanpa hak `pos.void`/`pos.refund` tetap bisa bertindak bila seorang atasan di outlet itu memasukkan PIN-nya; PIN atasan memakai penguncian yang sama dengan login, dan PIN salah tidak mengeluarkan kasir dari sesinya.
- **Pembatalan produk**: mengurangi atau menghapus item pada bill yang sudah tersimpan butuh alasan dan hak/persetujuan; pembatalan bill tersimpan juga. Menambah item tidak butuh persetujuan.
- **Refund** bill lunas, sebagian atau seluruhnya, bertahap: jumlah dibagi per baris sebanding harga setelah diskon (termasuk service, pajak, pembulatan), dan bila semua unit di-refund jumlahnya **tepat** sama dengan total yang dibayar (diuji dengan sapuan). Metode refund harus salah satu yang dipakai saat bayar; refund tunai mengurangi uang yang seharusnya ada di laci shift dan ditolak bila laci tidak cukup.
- **Aktivitas**: setiap buat/ubah/hapus item/batal/bayar/pisah/pindah meja/refund dicatat (siapa, kapan, alasan, penyetuju) dan bisa dilihat di Back Office (hanya baca, hak `reports.view`).
- Perhitungan refund adalah fungsi murni `computeRefund` (`packages/domain`).

**Catatan dan batas** (jangan dianggap ada):
- **Kirim ulang struk** (email/SMS) **belum dikerjakan**: butuh penyedia email/SMS. Cetak ulang struk dari daftar bill sudah ada.
- Refund dihitung dari total pesanan secara proporsional; **pajak dan service tidak dilaporkan terpisah per refund** (laporan di Fase 4 yang menentukan penyajiannya). Stok belum dikembalikan (Fase 5).
- Refund ke metode berbeda dari yang dipakai saat bayar, dan refund pada bill yang dibayar di shift yang sudah lama, belum diatur khusus (batas waktu refund belum ada).
- Tidak ada **gabung meja/bill** dan tidak ada reservasi. Denah memakai kisi tetap 24 x 14 sel dan meja berbentuk persegi/bulat saja.
- Aktivitas belum bisa difilter menurut tanggal atau pengguna, dan belum ada ekspor.
- Satu kasus uji browser sempat gagal sekali karena skrip membaca total sebelum harga selesai dihitung server (jeda 180 ms); skrip sudah diperbaiki dan lulus 6 kali berturut-turut. Aplikasi memang menampilkan harga setelah jeda singkat itu.

**Selesai bila**: alur dine-in lengkap termasuk refund berjalan. Tercapai (lihat `tools/verify_phase3.mjs`).

## Fase 4. Laporan dan dashboard — SELESAI 15 Okt 2026 (dengan batas di bawah)

**Berjalan dan teruji** (289 tes otomatis: 137 unit + 152 API; 66 pemeriksaan browser di `tools/verify_phase2/3/4.mjs`):
- **Dasbor**: kartu (penjualan kotor, diskon, refund, penjualan bersih, laba kotor, total diterima, jumlah transaksi), grafik penjualan harian, per jam, per hari-minggu, porsi kategori, item teratas, ringkasan meja (pax, pendapatan per pax, durasi), dan **perbandingan outlet**.
- **Laporan** (semua dengan filter rentang tanggal + outlet dan **ekspor CSV**): Ringkasan Penjualan, Transaksi (berhasil, dibatalkan, item dihapus + rincian struk), Shift, Metode Pembayaran, Tipe Penjualan, Penjualan Item/Kategori/Brand/Modifier, Diskon (diskon terdaftar, promo, manual), Pajak, Service Charge, Dikumpulkan Oleh, Laporan Meja, Perbandingan Outlet.
- **Definisi angka** (doc 02 bagian 8, domain `report.ts`): penjualan kotor = subtotal; penjualan bersih = nilai barang sebelum pajak/service setelah diskon dan refund; total diterima = total - refund. Identitas **bersih + service + pajak + pembulatan = total diterima** diuji untuk pajak ditambahkan, harga sudah termasuk pajak/service, pembulatan, dengan dan tanpa refund; tabel item/kategori menjumlah tepat ke ringkasan; contoh tangan di tes API mencocokkan setiap angka.
- **Zona waktu outlet**: batas hari (termasuk detik 23:59:59 dan 00:00:00), jam, dan hari-minggu mengikuti zona waktu tiap outlet; DST diuji. Refund dihitung pada hari refund (rincian nilai barang/service/pajak disimpan saat refund).
- **Akses**: butuh `reports.view`; pengguna hanya melihat outlet yang ditugaskan kepadanya (outlet lain ditolak), dan tidak pernah bisnis lain. Rentang maksimal 366 hari dan 100.000 transaksi per permintaan.
- CSV: BOM UTF-8 (Excel), judul kolom mengikuti bahasa permintaan, uang tanpa pemisah ribuan, baris total, perlindungan injeksi rumus.

**Catatan dan batas** (jangan dianggap ada):
- **Invoices** (faktur B2B) tidak dibuat: belum ada fitur faktur/pelanggan korporat (fase 6+). Ekspor ke Google Sheets tidak ada; hanya CSV.
- Laporan dihitung langsung dari tabel transaksi (tanpa tabel agregat harian). Cukup untuk puluhan ribu transaksi per rentang; di atas itu perlu tabel agregat `daily_sales` (doc 02 bagian 8).
- **HPP paket (bundle) belum dihitung**, jadi laba kotor paket terlalu tinggi; HPP item memakai modal varian yang dibekukan saat transaksi.
- Nilai refund di laporan item/kategori termasuk bagian pajak/service; kolom penjualan bersih memakai bagian nilai barang.
- Pajak dan service pada laporan Pajak/Service Charge adalah yang dipungut **sebelum refund** (ringkasan sudah memotongnya).
- Tidak ada pembanding periode sebelumnya, grafik per meja/kasir, laporan terjadwal lewat email, atau batas waktu zona waktu campuran dalam satu tabel (waktu ditampilkan dalam zona outlet pertama).
- Kartu "Laba kotor" bergantung pada modal item yang diisi pemilik; item tanpa modal menghasilkan laba = penjualan bersih.

**Selesai bila**: angka laporan cocok dengan data uji dan rumus doc 02 bagian 8. Tercapai.

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
