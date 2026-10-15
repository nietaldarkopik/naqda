# tools

Skrip bantu di luar aplikasi. Keluarannya ditulis ke `build/` (tidak masuk git).

| Skrip | Fungsi | Prasyarat |
|---|---|---|
| `verify_phase4.mjs` | Uji browser: membuat penjualan lewat API kasir lalu memeriksa dasbor, ringkasan, laporan item/pembayaran/diskon/shift/meja, transaksi + rincian, ekspor CSV, filter tanggal, RTL. Screenshot ke `build/web-shots-p4/` | Sama, dan database yang **bersih** |
| `verify_phase3.mjs` | Uji browser: tambah/geser meja di denah Back Office, pilih meja di kasir, persetujuan atasan (PIN salah dan benar), refund, pembatalan bill, halaman aktivitas, RTL. Screenshot ke `build/web-shots-p3/` | Sama, dan database yang **bersih** |
| `verify_phase2.mjs` | Uji browser kasir: PIN karyawan, pendaftaran perangkat, aktivasi, login PIN, buka shift, jual, bayar, struk, pisah bill, kas, tutup shift, RTL, pencabutan perangkat. Screenshot ke `build/web-shots-p2/` | Sama seperti di atas, dan database yang **bersih** (tes memeriksa total persis, termasuk pajak demo) |
| `verify_phase1.mjs` | Uji regresi di browser sungguhan (login, katalog, impor CSV, wizard promo, audit, investor, Arab/RTL). Menulis screenshot ke `build/web-shots-p1/` | `npm run dev` berjalan, database demo bersih (`npm run db:reset -- --yes && npm run db:migrate && npm run db:seed`), dan Playwright (`npm i -D playwright && npx playwright install chromium`) |
| `verify_phase5.mjs` | Uji browser: bahan, resep, PO diterima, produksi, penyesuaian, transfer (terima sebagian), batas stok + jual tetap di kasir, refund dengan kembali ke stok, ringkasan inventori, RTL. Screenshot ke `build/web-shots-p5/` | Sama, dan database yang **bersih** |
| `verify_phase6.mjs` | Uji browser: program loyalty dan reward lewat form, pelanggan, poin saat bayar, tukar reward (termasuk kode validasi), feedback dan balasan, riwayat poin, ekspor pelanggan, RTL. Screenshot ke `build/web-shots-p6/` | Sama, dan database yang **bersih** |
| `verify_phase7.mjs` | Uji browser: peran kustom, menu dan halaman terlindungi untuk karyawan terbatas, checkout, desain struk dengan pratinjau, metode pembayaran, notifikasi, slot karyawan, dan efeknya di kasir, RTL. Screenshot ke `build/web-shots-p7/` | Sama, dan database yang **bersih** |
| `make_pdf.py` | Menyusun dokumen `docs/*.md` menjadi `build/kasirku.html` | Python 3 dengan `markdown` (`pip install markdown`) |
| `pdf.mjs` | Mengubah `build/kasirku.html` menjadi `Naqdi-Dokumen-Pengajuan.pdf` | Playwright (di atas) |

Urutan membuat PDF: `python tools/make_pdf.py && node tools/pdf.mjs`.

Catatan: PDF memuat screenshot produk acuan dari `docs/assets/screens/`. Folder itu **tidak ikut git** (referensi
pihak ketiga, hanya untuk internal). Tanpa folder itu, bagian 4 PDF tidak bergambar.
