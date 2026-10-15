# 07. Platform: Naqdi sebagai layanan untuk banyak toko (SaaS)

Dokumen ini adalah rencana dan status. Keputusan bisnis diambil 16 Okt 2026; rinciannya di bagian 1.

## 1. Keputusan

| Hal | Keputusan |
|---|---|
| Model | Berlangganan **bulanan** atau **tahunan** |
| Pendaftaran | **Mandiri**: calon pelanggan mengunjungi situs atau mengunduh aplikasi lalu mendaftar sendiri |
| Uji coba | **Gratis 14 hari**, lalu langganan bulanan atau tahunan |
| Skala | Sekitar **2000 toko per tahun** (target tahun pertama) |
| Wilayah | **Lintas negara** (mata uang, pajak, dan hukum berbeda per negara) |
| Pembayaran **di toko** (pelanggan toko) | **Tunai dulu** (lihat roadmap Fase 9). Ini terpisah dari pembayaran **langganan** ke Naqdi di dokumen ini |

## 2. Prinsip

1. **Satu aplikasi, banyak bisnis terpisah** (multi-tenant) di satu database; isolasi data sudah diuji. Satu bisnis = satu mata uang = satu negara usaha.
2. **Jangan pernah menghapus atau mengunci data pelanggan secara diam-diam.** Saat uji coba atau langganan habis: masa tenggang, lalu **hanya-baca** (data tetap bisa dilihat dan diekspor), bukan dihapus. Penghapusan hanya lewat proses yang jelas dan tercatat.
3. **Catatan penjualan yang sudah terjadi tetap diterima**: penjualan offline yang disinkronkan setelah terkunci tetap dicatat, dan shift tetap bisa ditutup.
4. **Pengelola (operator) tidak memakai akun toko.** Ada akun pengelola terpisah, dan setiap tindakan pengelola tercatat.
5. Aturan murni ada di `packages/domain/src/plans.ts` dan diuji; server dan UI memakai kode yang sama.

## 3. Siklus hidup bisnis

```
 daftar ──> trial (14 hari) ──habis──> grace (7 hari) ──habis──> locked
              │                                                    ▲
              └─ bayar ──> active ──periode habis──> grace ───────┘
                              ▲            │
                              └──── bayar ─┘      suspended / cancelled ──> locked kapan saja
```

| Status | Akses | Keterangan |
|---|---|---|
| `trial` | penuh | `trialEndsAt` = daftar + 14 hari |
| `active` | penuh | `currentPeriodEndsAt` = akhir periode yang dibayar; kosong = tanpa batas (dikelola manual) |
| `past_due` | penuh sampai tenggang habis | pembayaran periode berikutnya belum masuk |
| masa tenggang | **penuh + peringatan** | `GRACE_DAYS` = 7 hari setelah uji coba atau periode habis |
| `locked` | Back Office **hanya-baca**; kasir **tidak bisa penjualan baru** | sinkron offline, tutup shift, ekspor, dan baca tetap jalan |
| `suspended` / `cancelled` | `locked` kapan saja | dihentikan pengelola atau berhenti langganan |

Pelanggan yang membayar langsung kembali penuh (cache status ≤ 15 detik di produksi; segera setelah pengelola mengubah).

## 4. Batas paket

Batas diterapkan **di server** saat menambah outlet, perangkat kasir, dan karyawan (409 dengan rincian). Bisa ditimpa per bisnis untuk kesepakatan khusus.

| Paket | Outlet | Perangkat | Karyawan |
|---|---:|---:|---:|
| `basic` | 1 | 3 | 10 |
| `pro` | 5 | 15 | 50 |
| `unlimited` | tanpa batas | tanpa batas | tanpa batas |

**Angka ini sementara.** Harga dan paket final belum diputuskan; jangan dipromosikan. `unlimited` dipakai bisnis lama, bisnis demo, dan yang dikelola manual. Batas item belum diterapkan.

## 5. Tahapan

| Tahap | Isi | Status |
|---|---|---|
| **12A** | Status langganan, uji coba, masa tenggang, terkunci; batas paket; spanduk di Back Office; penegakan di API dan kasir | **Selesai dan teruji** |
| **12B** | **Pendaftaran mandiri**: halaman daftar, uji coba 14 hari otomatis, perlindungan penyalahgunaan | **Selesai dan teruji, MATI di produksi** (lihat bagian 9) |
| **12C** | **Panel pengelola**: akun pengelola terpisah, daftar bisnis dan pemakaian, buat/perpanjang/tangguhkan, ubah paket dan batas, catatan audit pengelola | **Selesai** (panel di `/platform`; akun dibuat lewat `npm run platform:create-admin`; peran owner/support; token terpisah 8 jam) |
| **12D** | **Penagihan**: pembayaran langganan bulanan/tahunan lewat penyedia, webhook, faktur, jatuh tempo otomatis, pajak per negara | Butuh keputusan penyedia |
| **12E** | **Operasional skala**: uji beban, pemisahan baca/tulis, pengarsipan data lama, ekspor dan hapus per bisnis, pemantauan per bisnis | Sebelum peluncuran besar |
| **12F** | Akses bantuan (support) yang tercatat dan atas izin; pengumuman; halaman status | Setelah 12C |

## 6. Hal yang harus diputuskan sebelum 12B–12D

1. **Verifikasi email pendaftaran.** Aplikasi **belum punya pengirim email** (email hanya dicatat). Pendaftaran mandiri tanpa verifikasi membuka penyalahgunaan uji coba berulang dan akun palsu. Perlu memilih penyedia email (mis. SES, Postmark, Resend) sebelum peluncuran.
2. **Penyedia pembayaran langganan lintas negara.** Dua pendekatan:
   - *Merchant of Record* (mis. Paddle, Lemon Squeezy): mereka menjadi penjual resmi dan **menangani PPN/VAT/GST per negara**, mengurangi beban pajak Anda, dengan biaya lebih tinggi.
   - *Gateway* (mis. Stripe untuk kartu global; Midtrans/Xendit untuk QRIS, virtual account, dan e-wallet Indonesia): biaya lebih rendah, tetapi **Anda yang bertanggung jawab atas pajak penjualan digital** di tiap negara.
   Kemungkinan terbaik: MoR atau Stripe untuk luar negeri + gateway lokal untuk Indonesia. Perlu konsultan pajak.
3. **Harga dan paket**: jumlah paket, harga per mata uang atau satu mata uang acuan, diskon tahunan, dan apa yang tersedia di uji coba.
4. **Kebijakan setelah berhenti**: berapa lama data disimpan setelah `cancelled`/`locked`, kapan dihapus, dan apakah dapat diekspor penuh (disarankan: ekspor selalu bisa; hapus setelah 90 hari dengan pemberitahuan).
5. **Lokasi data**: satu wilayah server dulu atau per wilayah. Sebagian negara (mis. Arab Saudi, Uni Eropa) punya aturan pemindahan data pribadi lintas batas. Perlu tinjauan hukum sebelum menerima pelanggan di sana.
6. **Dokumen hukum**: ketentuan layanan, kebijakan privasi, perjanjian pemrosesan data (Anda memproses data pelanggan toko atas nama toko), dan prosedur kebocoran data. Di luar kode.

## 7. Kapasitas dan risiko (perkiraan kasar, BELUM diukur)

- 2000 toko dalam setahun bukan jumlah besar untuk satu MySQL **bila** beban per toko kecil. Tetapi dengan asumsi ilustratif 100–300 transaksi per toko per hari, 2000 toko menghasilkan sekitar 200 ribu hingga 600 ribu transaksi per hari, dan tiap transaksi menulis puluhan baris. Dalam setahun tabel `orders`/`order_items`/`payments` mencapai ratusan juta baris.
- Yang perlu **diukur, bukan ditebak**: uji beban pada puncak jam makan siang; kueri laporan berat (lintas tanggal) yang harus dipindah ke replika baca; pengarsipan atau partisi tabel besar per tahun; tekanan satu toko yang sangat ramai terhadap yang lain (batas laju per bisnis).
- **Satu database = satu titik gagal.** Rencanakan replika, cadangan yang diuji (sudah ada alatnya), dan pemulihan **per bisnis** (belum ada).
- Migrasi skema berlaku untuk semua bisnis sekaligus: perlu prosedur rilis bertahap.
- **Konkurensi**: sekali dalam sekitar tujuh kali jalan penuh, tes "pembayaran bersamaan" (5 pembayaran serentak di satu outlet) gagal dan lolos pada pengulangan; penyebabnya belum diketahui (dugaan: kebuntuan atau kehabisan waktu kunci di MySQL). Di skala 2000 toko ini harus dipastikan: ukur, lalu tambahkan percobaan ulang otomatis pada kebuntuan untuk transaksi bayar dan sinkron.

## 9. Pendaftaran mandiri (12B): cara kerja dan syarat peluncuran

Halaman `/{bahasa}/register` (tautan "Daftar gratis" di halaman login) memanggil `POST /api/v1/public/signup`, membuat bisnis (paket `basic`, status `trial`, 14 hari) beserta satu outlet dan satu admin dalam **satu transaksi**, lalu langsung memasukkan pendaftar ke Back Office. Negara mengisi mata uang, zona waktu, dan bahasa secara otomatis (bisa diubah); mata uang terkunci begitu ada data.

Perlindungan yang ada: kata sandi minimal 10 karakter; wajib menyetujui ketentuan (versi dan waktunya disimpan per bisnis); email unik tanpa membedakan huruf besar-kecil, juga aman terhadap pendaftaran serentak; **batas 5 pendaftaran per alamat IP per jam dan 300 total per jam**; kolom jebakan untuk robot. Alamat IP dihitung dari `X-Forwarded-For` dengan jumlah proxy tepercaya (`TRUST_PROXY_HOPS`, Apache + Next = 2), bukan entri pertama yang bisa dipalsukan.

**Pendaftaran MATI di produksi secara bawaan** (`SIGNUP_ENABLED`, bawaan: aktif di dev dan tes, mati di produksi). Menyalakannya: `SIGNUP_ENABLED=true pm2 start ecosystem.config.cjs` lalu `pm2 save`. **Jangan nyalakan untuk publik sebelum:**
1. **Verifikasi email** tersedia (butuh penyedia email). Tanpa itu siapa pun bisa membuat akun dengan email milik orang lain dan menumpuk uji coba gratis.
2. **Ketentuan layanan dan kebijakan privasi** sungguhan menggantikan halaman draf di `/legal/terms` dan `/legal/privacy` (sekarang bertanda DRAF dan belum ditinjau hukum).
3. Pembatas laju dan CAPTCHA ditinjau ulang (pembatas sekarang di memori satu proses; dengan beberapa instance perlu penyimpanan bersama).
4. Paket, harga, dan alur setelah uji coba (12D) diputuskan, karena pelanggan akan terkunci setelah 14+7 hari tanpa jalan untuk membayar.

## 8. Yang sudah ada dan bisa dipakai

- Isolasi data antar-bisnis (tes), pendaftaran bisnis lewat CLI (`npm run db:create-business`), mata uang per bisnis, slot karyawan, hak hapus/unduh/retensi data pelanggan, cadangan dan uji pemulihan, `/health`, log JSON.
- 12A: lihat bagian 3 dan 4. Aturan di `packages/domain/src/plans.ts`; penegakan di `apps/api/src/billing/`.
