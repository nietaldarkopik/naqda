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
- (Stok kini berkurang saat jual: lihat Fase 5.) Promo dievaluasi saat bill disimpan, bukan saat dibayar (bill yang disimpan sebelum promo berakhir tetap memakai promo itu).
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
- Refund dihitung dari total pesanan secara proporsional; **pajak dan service tidak dilaporkan terpisah per refund** (laporan di Fase 4 yang menentukan penyajiannya). Pengembalian ke stok tersedia sebagai opsi refund (Fase 5).
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
- HPP dibekukan saat transaksi: dari resep/biaya rata-rata bahan bila ada, kalau tidak dari modal varian; HPP paket = jumlah HPP komponen (Fase 5).
- Nilai refund di laporan item/kategori termasuk bagian pajak/service; kolom penjualan bersih memakai bagian nilai barang.
- Pajak dan service pada laporan Pajak/Service Charge adalah yang dipungut **sebelum refund** (ringkasan sudah memotongnya).
- Tidak ada pembanding periode sebelumnya, grafik per meja/kasir, laporan terjadwal lewat email, atau batas waktu zona waktu campuran dalam satu tabel (waktu ditampilkan dalam zona outlet pertama).
- Kartu "Laba kotor" bergantung pada modal item yang diisi pemilik; item tanpa modal menghasilkan laba = penjualan bersih.

**Selesai bila**: angka laporan cocok dengan data uji dan rumus doc 02 bagian 8. Tercapai.

## Fase 5. Stok dan ingredient — SELESAI 15 Okt 2026 (dengan batas di bawah)

**Berjalan dan teruji** (317 tes otomatis: 148 unit + 169 API; 85 pemeriksaan browser di `tools/verify_phase2/3/4/5.mjs`):
- **Buku besar stok** (`stock_movements`, hanya menambah) + saldo per outlet (`stock_levels`). Jumlah berskala 3 desimal, biaya **rata-rata tertimbang** per outlet; setiap baris mencatat saldo sesudahnya. Invarian diuji: untuk setiap objek, jumlah seluruh pergerakan = saldo, dan rantai saldo tidak patah, termasuk saat 5 pembayaran berjalan bersamaan (baris saldo dikunci dengan urutan tetap).
- **Bahan** (mentah dan setengah jadi), **resep setengah jadi** (hasil per produksi, resep bertingkat, siklus ditolak), **resep varian item**, **stok modifier** (bahan terpotong per opsi), dan komponen **paket**. Tombol **Produksi** memotong bahan dan menghitung biaya hasil = nilai bahan / jumlah hasil.
- **Penjualan memotong stok** saat dibayar (varian item yang dilacak, bahan resep, bahan modifier, komponen paket). **HPP kini dari resep**: biaya rata-rata bahan di outlet ini + modifier; tanpa resep memakai modal manual; paket = jumlah komponen. Nilai persediaan yang keluar sama dengan HPP di laporan.
- **Batas stok per outlet**: tanpa batas (boleh minus), tolak, atau tolak tetapi kasir boleh menjual tetap (dengan peringatan item apa yang kurang). Bill tetap terbuka bila ditolak; tidak ada pembayaran setengah jalan.
- **Refund dengan opsi "kembalikan ke stok"**: sebanding unit yang di-refund dan dengan biaya saat dijual; refund tanpa restock lalu dengan restock tidak mengembalikan lebih dari bagian unitnya.
- **Pemasok, PO** (nomor berurutan per outlet; terima sebagian atau seluruhnya; biaya rata-rata diperbarui saat barang diterima; batal bila belum ada yang diterima), **transfer antar outlet** (stok keluar saat dikirim, masuk saat diterima dengan biaya asal; terima sebagian, selisih dianggap hilang; batal mengembalikan ke asal), **penyesuaian / stok opname** (selisih terhadap saldo sistem beserta nilainya), peringatan stok menipis per outlet, riwayat pergerakan per objek.
- **Ringkasan Inventori** (awal, pembelian, penjualan, transfer, penyesuaian, produksi, akhir, nilai) dengan filter tanggal/outlet dan ekspor CSV; angka akhir sama dengan saldo stok.
- Halaman Back Office: Bahan, Resep dan Stok Modifier, Stok, PO, Transfer, Penyesuaian, Pemasok; kasir menampilkan sisa stok di tombol item.

**Catatan dan batas** (jangan dianggap ada):
- **PO/Transfer "Advanced"** (persetujuan berjenjang, pengiriman terpisah) **tidak dibuat**; hanya alur sederhana, dengan penerimaan sebagian. Tidak ada email PO ke pemasok.
- **Satu satuan per bahan**: tidak ada konversi satuan (beli per kg, resep per gram) — isi PO dalam satuan yang sama dengan resep. Tidak ada impor/ekspor bahan.
- Stok varian dilacak di tingkat **item** ("lacak stok" berlaku untuk semua varian item). Batas peringatan diatur di halaman Stok per outlet, bukan di form item.
- Pemotongan terjadi saat **dibayar**, bukan saat bill disimpan; dua bill terbuka bisa sama-sama "melihat" stok yang sama sampai salah satu dibayar.
- Refund tanpa "kembalikan ke stok" (mis. makanan terbuang) tidak mengubah stok dan tidak mencatat kerugian; catat lewat Penyesuaian bila perlu.
- Stok bahan yang dipakai resep tetapi `lacak stok` dimatikan tidak dipotong (hanya menjadi HPP).
- Nilai (Rp) per baris dibulatkan; jumlah seluruh baris bisa berbeda satu-dua satuan dari nilai saldo × biaya rata-rata.
- Notifikasi email stok menipis belum ada (hanya indikator di halaman Stok).

**Selesai bila**: tes alur stok (jual, refund, PO, transfer, adjustment) lulus semua. Tercapai.

## Fase 6. Pelanggan dan loyalty — SELESAI 15 Okt 2026 (dengan batas di bawah)

**Berjalan dan teruji** (340 tes otomatis: 156 unit + 184 API; 103 pemeriksaan browser di `tools/verify_phase2..6.mjs`):
- **Pelanggan**: daftar dengan ringkasan (bukan member, member, reward ditukar), cari nama/telepon/email, tambah/ubah/hapus, ekspor CSV, riwayat poin per pelanggan, penyesuaian poin manual (tidak boleh membuat saldo negatif). Telepon dan email unik per bisnis di antara pelanggan yang belum dihapus (nomor bisa dipakai lagi setelah hapus).
- **Program loyalty** (satu per bisnis): poin dari **total belanja** (tiap kelipatan Rp X = Y poin, dari penjualan bersih setelah diskon, kelipatan penuh saja) atau dari **item/kategori** (aturan item didahulukan); **bonus member baru** (sekali per pelanggan, tidak bisa diulang dengan keluar-masuk member); **kuota member**; **masa berlaku** (tanggal setempat); aktif/mati.
- **Reward**: potongan persen dari total (dengan batas maksimum), nominal dari total, atau diskon item/kategori (persen untuk semua baris cocok, nominal untuk satu unit); minimum belanja; poin yang dipakai. Server menghitung potongan (kasir tidak mengirim angka), dan reward tidak digabung dengan diskon pesanan manual.
- **Kasir**: pilih atau daftarkan pelanggan (dengan opsi jadi member), pilih reward (yang tidak cukup poin dinonaktifkan), poin tampil di struk (ditukar, didapat, saldo), dan feedback baik/buruk dengan komentar dari struk.
- **Penukaran** terjadi saat **dibayar** di dalam transaksi yang sama: poin dipotong, penukaran dicatat, lalu poin baru diberikan; bila poin tidak cukup lagi saat bayar, seluruh pembayaran ditolak dan bill tetap terbuka.
- **Kode validasi** (opsional): kode 6 angka berlaku 10 menit, sekali pakai, hanya hash yang disimpan; lima kali salah menghanguskan kode (percobaan salah tetap tercatat walau pembayaran dibatalkan).
- **Refund** mengurangi poin pesanan itu secara sebanding dan mengurangi total belanja; refund penuh membatalkan tepat semua poin yang didapat.
- **Buku besar poin** (`loyalty_ledger`, hanya menambah) dengan invarian diuji: saldo = jumlah buku besar, dan setiap baris mencatat saldo yang benar.
- **Masukan pelanggan** di Back Office: ringkasan baik/buruk, filter outlet/penilaian/tanggal, balasan.

**Catatan dan batas** (jangan dianggap ada):
- **SMS tidak terkirim**: belum ada penyedia SMS. Kode validasi hanya dicatat di `sms_outbox` (status `logged`) dan, di luar produksi, ditampilkan kepada kasir (`devCode`). **Di produksi fitur "butuh kode validasi" belum bisa dipakai sampai penyedia SMS dipasang.**
- Poin **tidak kedaluwarsa** dan tidak ada tingkat member (tier). Tidak ada impor pelanggan, penggabungan pelanggan ganda, atau "reset program".
- Poin yang sudah ditukar **tidak dikembalikan** saat pesanan itu di-refund. Refund bisa membuat saldo poin negatif bila poinnya sudah dipakai.
- Reward total mengikuti mode gabung diskon outlet; pada mode "salah satu" potongan hanya berlaku untuk baris tanpa diskon (potongan yang terpasang ditampilkan di keranjang).
- Poin dihitung dari pesanan yang dibayar dengan pelanggan terpilih; pesanan lama tidak dihitung ulang bila program diubah.
- Masukan pelanggan dicatat oleh kasir (belum ada tautan atau email yang diisi pelanggan sendiri).

**Selesai bila**: pelanggan baru mendaftar, mengumpulkan poin, lalu menukar reward. Tercapai (lihat `tools/verify_phase6.mjs`).

## Fase 7. Pengaturan dan hak akses — SELESAI 15 Okt 2026 (dengan batas di bawah)

**Berjalan dan teruji** (361 tes otomatis: 156 unit + 205 API; 127 pemeriksaan browser di `tools/verify_phase2..7.mjs`):
- **Peran dan hak akses** (Hak Akses Karyawan): peran kustom (nama, jenis akses, 14 hak dalam tiga kelompok) dibuat, diubah, disalin dari peran lain, dan dihapus (tidak bisa bila masih dipakai karyawan); **peran bawaan terkunci**. Konsistensi ditegakkan: akses Back Office wajib punya `backoffice.view`, akses aplikasi kasir wajib punya `pos.sell`.
- **Penegakan di API diuji dengan matriks**: untuk setiap hak (`library.manage`, `inventory.manage`, `customers.manage`, `employees.manage`, `outlets.manage`, `settings.manage`, `tables.manage`, `reports.view`) dibuat dua peran, "hanya hak itu" yang lolos dan "semua hak kecuali itu" yang ditolak (403). Hak aplikasi kasir dibaca dari peran **saat ini** di setiap permintaan (bukan dari token 12 jam): memindahkan kasir ke peran lain langsung berlaku, dan peran khusus Back Office langsung memutus sesi kasirnya.
- **Penegakan di UI**: menu disembunyikan dan halaman ditolak dengan pesan bila hak tidak ada (juga lewat URL langsung); diuji di browser dengan karyawan berperan "Hanya Laporan".
- **Checkout**: pajak, service charge, dan pisah bayar bisa dimatikan untuk seluruh bisnis (ditegakkan server, termasuk penolakan pisah bayar).
- **Desain struk** dengan **pratinjau langsung** yang memakai komponen yang sama dengan struk kasir: teks atas, situs web, media sosial, catatan kaki (bawaan/kustom/tanpa), lebar kertas 58/80 mm, dan tampilan nama/alamat/telepon outlet, kasir, meja, pelanggan dan poin, serta rincian pajak.
- **Metode pembayaran**: lima metode bawaan (tunai tidak bisa dimatikan), metode kustom non-tunai (mis. GoPay), urutan, nama tampilan, dan pembatasan per outlet; server menolak metode yang tidak aktif/tersedia di outlet itu; laporan pembayaran memakai nama kustom, dan metode yang dihapus tetap bernama di riwayat.
- **Slot karyawan** (batas karyawan aktif; yang nonaktif tidak memakai slot; pengaktifan ulang juga dibatasi) dan **PIN** karyawan dari fase 2.
- **Notifikasi email**: pengaturan penerima dan jenis (ringkasan harian, stok menipis) disimpan; tombol "buat pesan contoh" membuat ringkasan penjualan kemarin yang **dicatat** di `email_outbox`.

**Catatan dan batas** (jangan dianggap ada):
- **Email tidak terkirim**: belum ada penyedia email. Ringkasan harian dan peringatan stok **tidak dijadwalkan dan tidak dikirim**; yang ada hanya pengaturan dan pesan contoh yang dicatat.
- Perubahan peran berlaku di Back Office paling lambat setelah token akses (15 menit) diperbarui atau setelah masuk ulang; di kasir seketika.
- **Mode inventori "Advanced"** tidak dibuat (karena PO/transfer Advanced tidak ada, fase 5). **Track server**, "simpan/cetak bill" sebagai pengaturan, dan konfigurasi pembayaran mobile/EDC tidak dibuat. Metode kustom selalu non-tunai.
- Struk dicetak lewat dialog cetak browser; belum ada printer ESC/POS, logo gambar, atau struk Arab raster (fase 8 dan perangkat keras).
- Tidak ada profil akun lengkap (nama bisnis, alamat, penagihan), undangan karyawan lewat email, atau halaman tagihan.

**Selesai bila**: role Cashier tidak bisa membuka Back Office atau refund tanpa izin. Tercapai dan diuji (kasir app-only tidak bisa masuk Back Office, token kasir ditolak di API Back Office, refund tanpa hak butuh PIN atasan).

## Fase 8. Offline, PWA, dan kerapian (3–4 sesi) — BAGIAN A (INTI OFFLINE) SELESAI 15 Okt 2026

Dikerjakan bertahap. **Bagian A (inti offline) selesai dan teruji**; bagian B dan C di bawah **belum dikerjakan**.

**Bagian A: berjalan dan teruji** (387 tes otomatis: 165 unit + 222 API; 19 pemeriksaan browser di `tools/verify_phase8.mjs`):
- **Mesin harga bersama** (`packages/domain/src/cart.ts`): `priceLines`, `resolveCartOffline`, `priceCartOffline` murni, dipakai server **dan** kasir offline. Paritas diuji terhadap `/pos/price` untuk keranjang dengan modifier, service+pajak, promo, diskon baris/pesanan, diskon bebas nilai, dan paket; aturan keranjang (modifier wajib, lingkup diskon) ditegakkan sama.
- **Protokol sinkron idempoten** (`POST /pos/sync`, `GET /pos/pricing-pack`): id order = `clientId` UUID dari perangkat, sehingga pengiriman ulang atau serentak tidak pernah menggandakan order dan tidak menghilangkan nomor struk. Nomor struk resmi **berurutan tanpa celah** dan baru diberikan saat sinkron (struk offline berstatus "sementara", rujukan `OFF-yymmdd-nnnn`).
- **Antrean offline** (`packages/sync`, bebas React/browser) di atas `LocalStore` (IndexedDB di web): urutan terjaga, operasi hanya hilang setelah server menjawab, gangguan jaringan di tengah pengiriman tidak menghilangkan penjualan, penolakan permanen berstatus `failed` (bisa dicoba lagi atau dibuang kasir), penolakan sementara (mis. belum ada shift) menunggu otomatis.
- **PWA**: Service Worker (`public/sw.js`) menyimpan halaman kasir dan aset aplikasi agar bisa dibuka dan **dimuat ulang tanpa internet**; manifest dan ikon. API tidak pernah disimpan di cache Service Worker. Data katalog, tarif, promo, dan pengaturan disalin ke IndexedDB tiap kali online.
- **UI kasir**: lencana status (Online/Offline + jumlah menunggu), spanduk offline, daftar antrean dengan coba lagi/buang, riwayat "OFF-… → nomor struk resmi", struk sementara. Status online ditentukan dari hasil permintaan nyata (bukan `navigator.onLine`).
- **Kebijakan selisih harga**: total di tablet (yang sudah dibayar pelanggan) dicatat apa adanya. Server menghitung ulang total dari masukan perangkat dengan kode domain yang sama dan **menolak** bila tidak cocok (`inconsistent_quote`), lalu menandai di jejak aktivitas (`sync_review`, tampil di Back Office > Aktivitas Kasir): selisih terhadap harga server (`price_mismatch`), stok menjadi minus (`stock_negative`), dan jam perangkat salah (`clock_skew`).
- **Bukti kriteria selesai**: di browser sungguhan, kasir menjual 20 transaksi dengan jaringan diputus, memuat ulang halaman saat offline, lalu online kembali dengan jawaban server pertama sengaja dihilangkan: hasilnya tepat 20 order, 20 pembayaran, nomor struk berurutan.

**Batas Bagian A** (jangan dianggap ada):
- Offline hanya untuk **penjualan langsung** (bill baru dibayar saat itu juga). Meja, pelanggan/loyalty/reward, simpan bill, pisah bill, daftar bill, refund, batalkan bill, dan buka/tutup shift **butuh online** (tombolnya dinonaktifkan).
- **Masuk pertama dengan PIN tetap butuh koneksi.** Muat ulang halaman **tidak** mengeluarkan kasir: salinan sesi (token + shift terakhir) disimpan di `sessionStorage` (hilang saat tab/aplikasi ditutup, tidak dibagi antar tab, dihapus saat keluar/sesi berakhir/perangkat dicabut, dan dibuang bila token sisa < 1 menit). Konsekuensi keamanan yang disengaja: token sesi (12 jam) kini juga ada di penyimpanan browser, bukan hanya memori, sehingga XSS bisa membacanya; tablet kasir yang ditinggalkan dalam keadaan masuk tetap terbuka, jadi **tombol Keluar tetap wajib dipakai**. Hak kasir di layar bisa basi sampai server menolak (server selalu membaca hak terbaru). **PIN offline berbasis hash di perangkat sengaja tidak dibuat**: PIN 4–6 digit bisa ditebak habis dari hash dalam hitungan detik. Bila token habis (12 jam) atau kasir ditutup, kasir tetap harus online untuk masuk lagi.
- **Harga offline dipercaya dari perangkat terdaftar dan kasir berwenang**: server memastikan aritmetika dan id katalog sah, tetapi tidak dapat membuktikan harga katalog saat itu. Perangkat yang dimodifikasi bisa mengarang harga; satu-satunya pagar adalah penandaan `price_mismatch` yang **harus ditinjau pemilik**.
- Stok tidak dicek saat offline (penjualan offline boleh membuat stok minus, ditandai). Angka stok di katalog offline adalah salinan lama.
- Service Worker hanya aktif di **produksi** dan butuh **HTTPS** (atau localhost). Cache aset tidak dipangkas otomatis. Manifest memakai `start_url` bahasa bawaan (`/id/pos`).
- Penyimpanan perangkat yang dihapus (data situs dibersihkan, mode privat) menghapus antrean yang belum sinkron; kasir diperingatkan bila IndexedDB tidak tersedia.
- Layar offline sudah diperiksa di Arab (RTL) di browser desktop (tata letak, tanpa gulir horizontal). Belum diuji di tablet/ponsel nyata, dan belum di Safari/iOS.

**Bagian B (keamanan operasional): alat dan kode selesai dan teruji; tugas operator dan uji pihak ketiga belum.**

Berjalan dan teruji (393 tes otomatis):
- **Cadangan**: `npm run backup` (mysqldump `--single-transaction` → `.sql.gz` + SHA-256, menolak cadangan terpotong, pemangkasan `--keep`, opsi `--storage` untuk gambar unggahan). Diuji pada database sungguhan.
- **Uji pemulihan**: `npm run backup:verify` memulihkan cadangan ke database sementara dan memeriksa checksum, daftar tabel, InnoDB, jumlah baris (mode `--strict` = sama persis dengan sumber), baris yatim, nomor struk ganda, dan riwayat migrasi; database sementara selalu dihapus. Diuji pada cadangan baik **dan** cadangan rusak (terpotong/checksum salah ditolak dengan kode keluar 1).
- **Log terstruktur**: JSON satu baris per permintaan dengan `X-Request-Id`, tanpa isi permintaan, header, query string, atau IP (diuji). Galat tak tertangani dicatat dengan `stack`.
- **`/health`** untuk pemantau: 503 bila database mati, plus `diskFreePct`.
- **Jejak audit karyawan** (buat, ubah **peran/status/outlet**, hapus; kata sandi tidak pernah dicatat, diuji) dan label semua jenis entitas di penampil audit (3 bahasa). Void/refund sudah tercatat di Aktivitas Kasir (fase 3), penyesuaian stok dan perubahan hak akses di jejak audit (fase 5 dan 7).

Belum (dan **bukan tugas kode**):
- **Penjadwalan** cadangan di server, **salinan di mesin/disk lain**, dan **latihan pemulihan ke produksi**: tanggung jawab operator (panduan di doc 05 bagian 5a).
- HTTPS/proxy balik **diuji di server sungguhan**; pemantau eksternal dengan peringatan (tidak ada pengiriman peringatan otomatis dari aplikasi).
- Rate limit PIN per **perangkat/IP** (penguncian per pengguna sudah ada sejak fase 2; PIN salah di perangkat berbeda berbagi penghitung yang sama).
- Uji beban dan uji keamanan oleh pihak yang tidak menulis kodenya.
- Jejak audit karyawan dicatat setelah perubahan, tidak dalam satu transaksi dengannya (gagal mencatat = perubahan tetap jalan).

**Bagian C (perangkat): tata letak dan layar penuh selesai dan teruji di emulasi; uji perangkat dan printer nyata belum.**

Berjalan dan teruji (`tools/verify_phase8c.mjs`, 5 profil layar, lebih dari 50 pemeriksaan di Chromium dengan emulasi sentuh):
- **Responsif**: di bawah 1024 px (ponsel, tablet tegak) katalog memenuhi layar dan keranjang menjadi panel layar penuh yang dibuka dari bilah bawah (jumlah item + total); di 1024 px ke atas tetap dua kolom. Diperiksa di 390×844 (Indonesia dan Arab/RTL), 768×1024, 1024×768, dan 1280×800: tanpa gulir horizontal, jalur jual-bayar-struk lewat sentuhan, panel menutup sendiri setelah bayar.
- **Sentuhan**: target aksi utama (tombol PIN, bilah keranjang, +/- jumlah, Bayar, tombol header, kategori) setinggi ≥ 44 px di layar sempit; tanpa zoom ketuk-ganda, tanpa tarik-untuk-muat-ulang; area aman (notch/bilah gestur) dihormati (`viewport-fit=cover`, `env(safe-area-inset-*)`); tinggi layar memakai `100dvh`.
- **Layar penuh**: tombol layar penuh di header (disembunyikan bila browser tidak mendukung), manifest `display_override: fullscreen` (saat dipasang sebagai aplikasi), dan **layar tetap menyala** selama kasir terbuka (Screen Wake Lock).

Batas Bagian C (jangan dianggap ada):
- **Belum diuji di tablet/ponsel nyata**: yang diuji adalah emulasi Chromium desktop. Perilaku keyboard layar, gestur, kinerja di perangkat murah, dan keandalan penyimpanan offline di Android/iOS belum terbukti.
- iPhone/iPad Safari: tombol layar penuh tidak muncul (tidak didukung); gunakan "Tambah ke Layar Utama". Wake Lock dan Service Worker di Safari belum diuji.
- Dialog Back Office dan layar admin **tidak** dioptimalkan untuk ponsel (hanya kasir).
- **Struk Arab raster dan printer ESC/POS tetap belum ada** (butuh printer nyata; direncanakan fase 9/10). Struk saat ini lewat dialog cetak browser.

**Selesai bila**: kasir bisa menjual 20 transaksi tanpa internet lalu sinkron tanpa duplikat. **Tercapai untuk penjualan langsung** (lihat `tools/verify_phase8.mjs`); fase 8 secara keseluruhan baru bisa dinyatakan selesai setelah **uji di perangkat nyata** (bagian C) dan tugas operator di bagian B.

## Tambahan setelah Fase 8: barcode produk dan scan di kasir — SELESAI 15 Okt 2026 (scanner keyboard)

**Berjalan dan teruji** (411 tes otomatis; `tools/verify_barcode.mjs` di browser):
- **Satu barcode per varian**, kolom terpisah dari SKU, unik per bisnis (tidak peka huruf besar-kecil, dijaga indeks unik di database; varian yang dihapus melepaskan barcode-nya). Bisnis lain boleh memakai kode yang sama.
- **EAN-13 pabrik dan kode sendiri** sama-sama bisa. Kode berupa **tepat 13 digit dianggap EAN-13 dan harus lolos digit pemeriksa** (menangkap salah ketik); karena itu **kode buatan sendiri jangan berupa tepat 13 digit**. Karakter: ASCII tanpa spasi, maks. 64.
- **Back Office**: kolom Barcode per varian di form item (Enter dari scanner tidak mengirim formulir), pencarian item/varian lewat barcode, kolom `barcode` di ekspor dan impor CSV. Impor **tanpa** kolom barcode atau dengan sel kosong **tidak menghapus** barcode yang ada. API `PATCH` varian tanpa field barcode membiarkannya (null menghapus).
- **Kasir**: scanner USB/Bluetooth mode keyboard (ketikan cepat + Enter, jeda < 40 ms; mengetik manual tidak dianggap scan). Scan menambah 1 unit, scan berulang menambah jumlah; pencocokan barcode dulu lalu SKU; bunyi dan pesan; kode tidak dikenal tidak mengubah keranjang. Item dengan modifier wajib membuka dialog pilihan. Scan **diabaikan saat ada dialog terbuka** (mis. sedang membayar) dan di kolom isian selain kolom cari. Bekerja **offline** (katalog tersimpan di perangkat; katalog lama yang belum memuat barcode tetap bisa lewat SKU).

**Batas** (jangan dianggap ada):
- **Belum ada scan dengan kamera** (butuh HTTPS dan pustaka/BarcodeDetector) dan belum ada **cetak label barcode**.
- Tiap scan menambah 1 unit; belum ada kuantitas lewat barcode berawalan, atau barcode kemasan/berat (EAN timbangan).
- Diuji dengan simulasi ketikan di Chromium, **belum dengan scanner fisik**. Scanner yang dikonfigurasi tanpa Enter, atau dengan awalan/akhiran lain, tidak akan terdeteksi; atur scanner agar mengirim Enter di akhir.
- Dua perangkat memakai barcode berbeda untuk produk yang sama tidak didukung (satu barcode per varian, sesuai keputusan).

## Tambahan setelah Fase 8: perlindungan data pelanggan dan nomor pajak — SELESAI 16 Okt 2026

**Berjalan dan teruji** (446 tes otomatis; `tools/verify_privacy.mjs` di browser):
- **Persetujuan**: telepon atau email pelanggan hanya boleh disimpan bila persetujuan dicentang (Back Office dan kasir); server menolak (422) tanpa itu dan mencatat waktu persetujuan (`customers.consent_at`). Pelanggan hanya bernama tidak butuh persetujuan. Pelanggan lama sebelum fitur ini tidak punya catatan persetujuan (ditampilkan apa adanya); mengisi telepon/email mereka kini minta persetujuan.
- **Hapus data pribadi (hak hapus)**: anonimisasi permanen yang **menyapu semua salinan**: nama/telepon/email/catatan pelanggan, nama yang dibekukan di `pricing_snapshot` struk, pesan SMS dan struk keluar, komentar dan balasan masukan, catatan manual poin, dan ringkasan jejak audit entitas itu. Baris pelanggan tetap ada (bernama "(data dihapus)", disembunyikan dari daftar) agar transaksi, poin, dan laporan tidak rusak. Nomor telepon yang dihapus bisa dipakai pelanggan lain. Penghapusan tercatat di audit **tanpa data pribadi**. Terbukti menangkap satu bug nyata saat pengujian (kolom uuid biner membuat sapuan snapshot melewatkan baris).
- **Unduh data (hak akses/portabilitas)**: JSON berisi profil, persetujuan, transaksi, buku besar poin, penukaran, dan masukan; tercatat di audit.
- **Retensi**: kebijakan bulan di Pengaturan > Akun (1-240), dan di halaman Pelanggan > Pelanggan tidak aktif: **periksa dulu (dry-run)** lalu hapus; aktivitas = perubahan data, transaksi dibayar, atau mutasi poin terakhir.
- **Hak akses**: hanya `customers.manage`; bisnis lain tidak bisa melihat atau menghapus (404).
- **Nomor pajak di struk**: Pengaturan > Desain Struk > Nama nomor pajak + Nomor pajak usaha (NPWP, VAT No., TRN, dan seterusnya), tampil di pratinjau dan struk kasir.
- **Bahan verifikasi akuntan**: `docs/06-contoh-perhitungan.md` dihasilkan `npm run docs:tax-examples` dari mesin hitung sungguhan (rupiah, dolar AS, riyal, SGD; harga termasuk/di luar pajak; tiga cara gabung diskon; arah pembulatan).

**Batas** (jangan dianggap ada):
- **Penghapusan data tidak otomatis terjadwal**: retensi dijalankan manual dari halaman Pelanggan (tidak ada penjadwal tugas di aplikasi). Cadangan database (`npm run backup`) **tetap memuat data lama** sampai cadangan itu sendiri dihapus/kedaluwarsa; kebijakan retensi cadangan menjadi tugas operator.
- Yang dianonimkan hanya data **pelanggan**. Data karyawan, label atau catatan teks bebas pada order/bill (mis. nama di "label"), dan nama di catatan item tidak disapu.
- Tidak ada portal mandiri bagi pelanggan, pencatatan banyak jenis persetujuan (mis. pemasaran terpisah), atau pencabutan persetujuan yang otomatis menghapus (pencabutan = jalankan Hapus data pribadi).
- Dokumen kebijakan privasi, ketentuan layanan, penunjukan penanggung jawab data, dan prosedur pelaporan kebocoran data berada **di luar kode**.
- Nomor pajak hanya dicetak; belum ada validasi format per negara dan belum ada e-faktur atau e-invoicing.

## Fase 9 (opsional). Integrasi — DITUNDA (diputuskan 15 Okt 2026): untuk sekarang hanya TUNAI

Naqdi akan dipakai pelanggan di Indonesia **dan** toko di luar negeri, dan penyedia pembayaran berbeda per negara. Karena itu
integrasi pembayaran digital sengaja **belum dikerjakan**; yang berlaku sekarang:
- **Hanya tunai yang diproses sistem.** Metode non-tunai bawaan (kartu, QRIS, e-wallet, transfer) dan metode kustom hanya
  **mencatat pilihan kasir**: sistem tidak memeriksa uang masuk dan tidak terhubung ke penyedia mana pun. Peringatan ini tampil di
  Pengaturan > Metode Pembayaran. **Matikan metode non-tunai yang tidak Anda verifikasi sendiri** (bawaan semuanya aktif).
- Item lain di fase ini (storefront online, GoFood/GrabFood, SMS/email nyata, printer ESC/POS) tetap opsional dan terpisah dari
  pembayaran; tiap item butuh keputusan penyedia dan akun, dan **tidak ada yang dikerjakan**.

**Kesiapan toko luar negeri (sudah ada dan teruji):**
- Mata uang dan jumlah desimal per bisnis (`businesses.currency`, `currency_exponent`); semua uang disimpan sebagai bilangan bulat satuan
  terkecil. Total USD (2 desimal) dengan pajak 8,25% di luar harga dan pembulatan tunai 5 sen diuji tepat dalam sen (`apps/api/test/currency.test.ts`).
- Pajak, service charge, harga termasuk/tanpa pajak, dan pembulatan (kelipatan dan arah) diatur **per outlet**; zona waktu per outlet.
- Tombol uang tunai cepat memakai pecahan umum mata uang bisnis (`quickCashAmounts`; IDR, USD, EUR, GBP, JPY, dan lain-lain, cadangan
  generik untuk yang belum terdaftar). Sebelumnya pecahan rupiah tertanam dan salah untuk mata uang berdesimal.
- Bahasa antarmuka: Indonesia, Inggris, Arab (RTL).

**Mata uang non-rupiah (selesai dan teruji, 15 Okt 2026)** (437 tes otomatis; `tools/verify_currency.mjs` di browser):
- **Daftar mata uang resmi** (`packages/domain/src/currency.ts`, 28 mata uang): rupiah, dolar (USD, SGD, AUD, CAD, NZD, HKD, BND), riyal dan Timur
  Tengah (SAR, AED, QAR, OMR, KWD, BHD, JOD, EGP), serta EUR, GBP, CHF, MYR, THB, PHP, VND, INR, CNY, JPY, KRW, TRY. **Jumlah desimal diturunkan dari
  kode ISO** (rupiah 0, dolar dan riyal 2, dinar 3) dan diuji terhadap `Intl`; kombinasi salah (mis. USD 0 desimal) ditolak.
- **Format**: rupiah selalu `Rp 18.000` **juga di antarmuka Inggris dan Arab**; dolar `$12.37` (`A$`, `CA$`, `NZ$`, `HK$` untuk dolar lain, `SGD` di
  Inggris); riyal Saudi `SAR 12.50` di Inggris/Indonesia dan `12.50 ر.س.` di Arab dengan digit Latin; dinar tiga desimal. Dibuktikan di kasir dan
  struk untuk USD, SAR, IDR, dan AUD.
- **Membuat bisnis dengan mata uang pilihan**: `npm run db:create-business -- --name "Toko Riyadh" --currency SAR --timezone Asia/Riyadh --locale ar
  --admin-email owner@toko.com` (tanpa data demo; kata sandi acak ditampilkan sekali). Dipakai sampai ada pendaftaran di UI.
- **Uang tunai cepat** per mata uang (lihat di atas); hitungan pajak dan pembulatan tepat dalam satuan terkecil (diuji USD dengan pajak 8,25% dan
  pembulatan 5 sen; SAR dengan PPN 15%, 12,50 x 3 = 37,50 + 5,63 = 43,13).
- Ekspor/impor CSV memakai **satuan terkecil** (USD: 1237 berarti $12.37), bukan satuan utama; perhatikan saat mengimpor untuk mata uang berdesimal.

**Belum ada untuk toko luar negeri** (jangan dianggap ada):
- **Mata uang hanya bisa diganti selama bisnis masih kosong**: semua uang disimpan sebagai bilangan bulat satuan terkecil, jadi mengganti mata
  uang setelah ada data bernilai uang (transaksi, shift, item, paket, modifier, diskon, promo, bahan, PO, reward) menggeser semua angka. Pemilih
  ada di Pengaturan > Akun dan Slot; terkunci otomatis begitu data pertama ada (server menolak dengan 409 dan daftar alasannya). Tidak ada
  konversi data, dan harga yang sudah diisi tidak ikut diubah saat mata uang diganti, jadi **pilih mata uang sebelum membuat item**.
- Aturan pajak/struk/privasi negara lain (mis. nomor pajak di struk, e-invoicing, GDPR) **belum ditinjau**; yang dipetakan baru Indonesia.
- Satu bisnis memakai satu mata uang (tidak ada multi-mata-uang atau kurs). Bahasa selain tiga di atas belum ada.

**Catatan desain untuk metode pembayaran di kemudian hari** (agar penambahan tidak merombak yang sudah ada):
1. **Pola penyedia (adapter)** per negara/penyedia dengan antarmuka kecil: `createCharge`, `getStatus`, `refund`, dan penerima `webhook`.
   Tambahkan penyedia tanpa mengubah mesin hitung (`packages/domain`) atau struktur `payments`.
2. **Kolom `payments` sudah cukup menampung**: `method` (kunci metode), `tendered`/`applied`, `reference` (id transaksi penyedia). Yang perlu
   ditambah nanti: `provider`, `status` (`pending|succeeded|failed|refunded`), `provider_payload` (JSON), dan tabel kejadian webhook.
3. **Status "menunggu" pada order**: pembayaran digital bersifat asinkron. Bill tidak boleh menjadi `paid` (dan nomor struk resmi tidak boleh
   diberikan) sebelum penyedia mengonfirmasi; pembayaran tunai tetap seketika seperti sekarang.
4. **Idempoten dan rekonsiliasi**: setiap permintaan ke penyedia membawa kunci idempoten (id order + percobaan); webhook diverifikasi tanda tangannya
   dan diproses sekali; ada laporan rekonsiliasi (pembayaran di Naqdi vs catatan penyedia) dan penanganan webhook yang terlambat/ganda.
5. **Offline**: pembayaran elektronik **butuh online**. Saat ini jalur offline (fase 8) mengizinkan metode apa pun yang aktif di outlet, dan
   non-tunai hanya dicatat manual. Begitu ada penyedia nyata, metode elektronik **harus dinonaktifkan otomatis saat offline** (hanya tunai
   dan pencatatan manual yang tersisa), kalau tidak penjualan offline akan mencatat "dibayar" tanpa konfirmasi penyedia.
6. **Refund** lewat penyedia (bukan hanya mencatat): refund sekarang mengembalikan uang lewat metode yang dipakai saat membayar dan, untuk non-tunai,
   hanya mencatat. Perlu langkah "minta refund ke penyedia" dan statusnya.
7. **Konfigurasi per bisnis/outlet**: kunci API penyedia disimpan terenkripsi di server (bukan di klien), dipilih per negara/mata uang; metode hanya
   tampil bila penyedianya mendukung mata uang bisnis.
8. **Hukum dan izin**: QRIS dan e-wallet di Indonesia hanya lewat penyedia berizin (PJP/Bank Indonesia); negara lain punya aturan berbeda (PCI-DSS untuk
   kartu: jangan pernah menyimpan nomor kartu; gunakan token penyedia). Konfirmasi dengan konsultan sebelum memproses uang sungguhan.

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

**Status (2026-10-16)**: kerangka Capacitor 7, adapter perangkat keras, cetak struk raster ESC/POS, pindai kamera, dan dialog printer sudah ada dan teruji di cangkang simulasi; **APK belum dibangun dan printer Bluetooth belum dicoba di perangkat nyata** (lihat docs/08-mobile.md bagian 5). `LocalStore` SQLite dan notifikasi pesanan belum dikerjakan.

Catatan: fase 10 dan 11 hanya efisien bila aturan di doc 02 bagian 1a dipatuhi sejak fase 0
(API token, paket `domain`/`sync`/`hardware` bebas dari React dan browser).

## Fase 12. Platform SaaS (pendaftaran mandiri, uji coba, langganan) — 12A dan 12B SELESAI 16 Okt 2026

Rencana lengkap, keputusan bisnis, kapasitas, dan pertanyaan terbuka ada di **`docs/07-platform-saas.md`**. Ringkasnya: pendaftaran mandiri, uji coba gratis 14 hari,
langganan bulanan atau tahunan, sekitar 2000 toko per tahun, lintas negara.

**12A selesai dan teruji** (461 tes otomatis):
- Siklus hidup bisnis (`trial`, `active`, `past_due`, `suspended`, `cancelled`) dengan masa tenggang 7 hari dan penguncian **hanya-baca** (Back Office dapat dibaca dan diekspor; kasir tidak bisa penjualan baru; sinkron offline dan tutup shift tetap diterima). Aturan murni di `packages/domain/src/plans.ts`.
- Batas paket (outlet, perangkat kasir, karyawan) ditegakkan di server dengan timpaan per bisnis. **Angka paket dan harga masih sementara.**
- Spanduk status langganan di Back Office (sisa uji coba, tenggang, terkunci) dan kolom baru di `businesses` (migrasi 0014); bisnis yang sudah ada otomatis `unlimited` dan aktif.
- `npm run db:create-business -- --plan basic --trial-days 14` untuk membuat bisnis uji coba dari terminal.

**12B selesai dan teruji, tetapi MATI di produksi**: pendaftaran mandiri (halaman daftar, uji coba 14 hari otomatis, batas per IP, kolom jebakan, ketentuan draf). Syarat sebelum dibuka untuk publik ada di `docs/07-platform-saas.md` bagian 9 (terutama verifikasi email dan dokumen hukum).

**12C selesai**: panel pengelola di `/platform` (ringkasan, daftar dan cari bisnis, buat bisnis, perpanjang uji coba, tangguhkan, ubah paket dan batas khusus, langganan, jejak audit; peran owner dan support hanya-lihat).

**12D tahap 1 selesai**: pembayaran langganan lewat transfer manual (faktur, bukti transfer, verifikasi pengelola, perpanjangan periode, faktur perpanjangan otomatis; lihat docs/07 bagian 5b). Google Play untuk aplikasi seluler didesain tetapi belum dibuat (docs/07, 12D-2).

**Belum**: penagihan lewat penyedia lain langganan (12D; butuh keputusan penyedia pembayaran dan pajak per negara), kesiapan skala (12E: uji beban, pemulihan per bisnis, pengarsipan), akses bantuan tercatat (12F).

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
| Jejak audit void, refund, adjustment, ubah peran | Selesai (void/refund: Aktivitas Kasir fase 3; adjustment dan peran: audit fase 5/7; karyawan: fase 8B) | 2–8 |
| Kata sandi di-hash, token berumur pendek, pembatasan login | Selesai | 0 |
| Login PIN kasir dengan penguncian setelah salah berulang, pendaftaran perangkat | Selesai (diuji sejak fase 2) | 2 |
| Cadangan database terjadwal dan **uji pemulihan** | Alat selesai dan teruji (`npm run backup`, `backup:verify`); **penjadwalan dan salinan di luar mesin belum dilakukan operator** | 8 |
| HTTPS dan proxy balik; rahasia produksi di luar repo | Panduan ada, belum diuji di server | 8 |
| Pemantauan (log terstruktur, pemberitahuan galat, ruang disk) | Sebagian: log JSON dan `/health` (db, disk) selesai; pemberitahuan galat otomatis belum | 8 |
| Mode offline dan sinkron tanpa duplikat | Selesai untuk penjualan langsung (fase 8A); transaksi lain tetap butuh online | 8 |
| Pengaturan harga termasuk pajak per outlet dan fungsi hitung pajak (eksklusif/inklusif) | Selesai, teruji | 1 |
| Penghitungan pajak/gratuity/pembulatan di keranjang sesuai aturan setempat, diverifikasi dengan akuntan | **Bahan verifikasi siap**: `docs/06-contoh-perhitungan.md` (8 skenario dihasilkan dari mesin hitung sungguhan, dengan daftar pertanyaan untuk akuntan). **Verifikasi profesional belum dilakukan** | 2 |
| Pembaruan sebagian (PATCH) tidak menimpa data lain | Selesai, ada tes regresi | 1 |
| Struk memenuhi ketentuan setempat (NPWP, nomor struk berurutan tanpa celah) | Nomor struk berurutan tanpa celah: selesai dan teruji. **Nomor pajak (NPWP/VAT No./TRN) bisa diisi pemilik dan dicetak di struk**. Kelengkapan unsur wajib menurut hukum setempat **belum diverifikasi** | 2 dan 8 |
| Pembayaran digital sungguhan (QRIS/e-wallet) lewat penyedia berizin | **Ditunda sengaja; tunai dulu.** Non-tunai hanya pencatatan manual (diperingatkan di UI); rancangan penyedia ada di Fase 9 | 9 |
| Perlindungan data pribadi pelanggan (UU PDP): persetujuan, hak hapus, retensi | Selesai di kode dan teruji: persetujuan tercatat, unduh data, hapus data (anonimisasi), retensi manual. **Kebijakan privasi, prosedur permintaan subjek data, dan penanganan kebocoran data di luar kode** | 6–7 dan setelah 8 |
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
