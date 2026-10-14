# 01. Spesifikasi Produk

Dokumen ini mendefinisikan **apa** yang dibangun. Sumbernya adalah analisis 16 video tutorial
(lihat `research/BACKOFFICE_FEATURES.md`). Nama produk: **Naqdi**.

> Ini clone fungsional untuk pembelajaran. Jangan memakai logo, nama merek, gambar, atau teks
> pemasaran asli. Semua aset visual dibuat sendiri.

## 1. Tujuan dan ruang lingkup

Aplikasi kasir (POS) berbasis cloud untuk bisnis F&B dan retail, terdiri dari dua permukaan:

| Permukaan | Pengguna | Perangkat | Fungsi utama |
|---|---|---|---|
| **Back Office** | Pemilik, manajer | Browser desktop | Master data, laporan, stok, pengaturan |
| **Kasir (POS)** | Kasir, pelayan | Tablet (PWA) | Transaksi, meja, shift, refund |

Satu **bisnis** punya banyak **outlet**. Hampir semua data bisa dibatasi per outlet.

**Di luar lingkup versi 1**: Moka Order (pesan via QR pelanggan), integrasi GoFood/GrabFood asli,
pembayaran digital sungguhan (QRIS/e-wallet), billing langganan, Capital, Partner Solutions,
Customer Display, cetak ke printer fisik. Semuanya disiapkan sebagai antarmuka/stub (lihat bagian 6).

**Platform target**: web, desktop, dan mobile. Versi 1 dirilis sebagai web (Back Office + kasir PWA).
Aplikasi kasir desktop (Windows) dan mobile (Android, lalu iOS) menyusul memakai basis kode yang sama
(lihat doc 02 bagian 1a dan roadmap fase 10–11). Back Office tetap web.

**Bahasa**: Indonesia (default), Inggris, dan Arab. Bahasa Arab menuntut tata letak **kanan-ke-kiri (RTL)**
di seluruh Back Office dan aplikasi kasir. Seluruh teks antarmuka harus melewati katalog terjemahan sejak
awal, sehingga bahasa baru bisa ditambah tanpa mengubah kode (lihat doc 02 bagian 1c).
Pemilik bisnis juga bisa menerjemahkan nama item, kategori, dan teks struk per bahasa.

## 2. Peran dan hak akses

Role bawaan: Administrator, Cashier, Head Bar and Kitchen, Investor, Regional Sales Manager.
Role bisa dibuat sendiri. Tiap role punya:
- **Jenis akses**: `app_only`, `backoffice_only`, `app_and_backoffice`.
- **Daftar privilege** (checklist), misalnya: kelola diskon, refund, laporan meja, pembayaran,
  pengaturan akun, struk, notifikasi email, void, kelola stok.
- Karyawan memakai **PIN 4 digit** di aplikasi kasir. Karyawan terikat pada satu atau beberapa outlet.
- Kuota karyawan per paket (lihat bagian 7).

## 3. Modul Back Office

### 3.1 Dashboard
- Tab **Summary** dan **Outlet Comparison**. Filter outlet dan rentang tanggal.
- Kartu: Gross Sales, Net Sales, Gross Profit, Transactions, Average per Transaction, Gross Margin.
- Grafik: penjualan harian, per hari dalam minggu, per jam. Pie kategori (volume dan sales). Top items.
- Ringkasan meja: total pax, rata-rata pendapatan per pax, rata-rata lama makan.
- Outlet Comparison: kolom per outlet berdampingan.

### 3.2 Laporan
| Laporan | Isi |
|---|---|
| Sales Summary | Gross, Discounts, Refunds, Net, Gratuity, Tax, Rounding, Total Collected |
| Gross Profit, Payment Methods, Sales Type, Item Sales, Category Sales, Brand Sales, Modifier Sales, Discounts, Taxes, Gratuity, Collected By | Pivot per dimensi, filter outlet dan tanggal |
| Transactions | Tab Success, Cancelled, Void Items. Detail struk, Resend Receipt, Issue Refund |
| Invoices | Status Paid/Overdue/Due, Record Payment, Resend |
| Shift | Kas awal, penjualan tunai, refund tunai, expected vs actual, selisih |

Semua laporan bisa **Export** (CSV).

### 3.3 Library (master data penjualan)
- **Item**: nama, kategori, brand, deskripsi, gambar, varian (nama, harga, SKU),
  harga berbeda per **sales type**, pelacakan stok + alert, COGS, modifier yang dipakai,
  dipasang per outlet atau "Save to All Outlets". Import/Export spreadsheet.
- **Modifier**: set modifier, opsi + harga, batas pilihan (min/maks), stok modifier terhubung ke ingredient.
- **Kategori**, **Brand**.
- **Bundle Package**: kumpulan item (pilih varian), harga bundle, harga per sales type, outlet, status aktif.
- **Promo**: tipe *Discount per Item*, *Free Item* (beli X gratis Y), dan tipe lain. Wizard 4 langkah:
  Info, Syarat Pembelian (item atau kategori + jumlah), Reward, Konfigurasi (kelipatan, periode, jam, hari).
- **Discount**: nilai tetap (%, Rp) atau bisa diisi kasir. Assign ke outlet.
- **Tax**, **Gratuity** (service charge): persen, assign ke outlet.
- **Harga termasuk pajak atau belum** diatur **per outlet** (tiap toko berbeda): inklusif memisahkan pajak dari harga menu, eksklusif menambahkannya di atas harga.
- **Sales Type**: Dine In, Take Away, GoFood, dst., dengan gratuity yang berlaku.

### 3.4 Ingredient dan resep
- Ingredient **Raw** dan **Semi-Finished**, unit (gram, ml, pcs, ...), kategori, stok + alert, rata-rata biaya.
- Semi-Finished punya resep dan aksi **Produce**.
- **Recipe** per item dan varian: daftar ingredient + jumlah, total biaya rata-rata.
- Stok ingredient terpotong otomatis saat item terjual, termasuk dari **Modifier Stock**.
- COGS dihitung dari biaya rata-rata ingredient.

### 3.5 Inventory
- **Summary**: Beginning, Purchase Order, Sales, Transfer, Adjustment, Ending per periode dan outlet.
- **Suppliers**.
- **Purchase Order**: mode Simple (langsung selesai) dan Advanced (approval, shipment, fulfillment,
  partial). Email notifikasi, print, history log.
- **Transfer** antar outlet: Simple dan Advanced.
- **Adjustment** (stock opname): stok sistem vs aktual, selisih, catatan, ringkasan expense/income.
- Berlaku untuk **Item** dan **Ingredient** (toggle).

### 3.6 Customers
- Customer List (member/non-member, poin, lifetime spending), Import/Export.
- Feedback (percakapan per pelanggan).
- **Loyalty Program**: poin dari total belanja atau dari item/kategori, bonus member baru,
  daftar reward (% diskon, Rp diskon, diskon item), kode validasi SMS, masa berlaku.

### 3.7 Employees
Employee Slots (undang karyawan), Employee Access (role + privilege), PIN Access.

### 3.8 Table Management
Table Group, Table Map (kanvas drag-and-drop, nama + kapasitas), Table Report.

### 3.9 Online Channels
Halaman pengaturan integrasi (stub): Moka Order-style storefront dan GoFood-style linking.

### 3.10 Account Settings
Account, Billing (stub), Outlets, Bank Account, Public Profile, **Receipt** (desain + preview),
**Checkout** (pajak, gratuity, pembulatan, batas stok + override, track server, split payment,
save/print bill), **Inventory** (Simple/Advanced), Email Notification, **Payment Configuration**
(metode pembayaran aktif per kelompok outlet).

## 4. Modul Kasir (POS)

Menu: Denah Meja · Point of Sale · Pesanan Online · Aktivitas · Inventori · Shift · Pengaturan.

- **Layar penjualan**: tab Favorit (grid, bisa diatur), Library (cari + telusuri), Custom (keypad nominal).
  Keranjang: pelanggan, sales type, item, subtotal, pajak/gratuity, Simpan Bill, Cetak Bill, Pisah Bill, Bayar.
- **Dialog item**: varian, modifier, jumlah, diskon, sales type per item, catatan.
- **Bill**: Open Bill, pembatalan bill, pembatalan produk. **Pisah Bill** (per item/qty) dan **Pisah Bayar**.
- **Denah meja**: grup, status kosong/terisi + total, mulai bill (pax + pelayan).
- **Pembayaran**: tunai (nominal cepat + kembalian), e-wallet, QRIS, EDC, transfer, dll. Kirim struk via email/SMS, cetak.
- **Pelanggan**: tambah, cari, loyalty (daftar member, saldo poin, redeem reward, kode validasi).
- **Aktivitas**: riwayat hari ini, cari struk, kirim ulang struk, **Refund** (item + qty + alasan).
- **Inventori**: lihat stok per produk/varian.
- **Shift**: mulai otomatis dengan kas awal, kas masuk/keluar, produk terjual, **Akhiri Shift**
  (expected vs actual, selisih), histori shift, cetak rekap.
- **Pengaturan**: pesanan online, pembayaran, pajak, biaya tambahan, printer, bahasa, profil.
- Harus tetap bisa dipakai saat koneksi putus (lihat doc 02, bagian offline).

## 5. Alur utama

1. **Transaksi dine-in**: pilih meja, isi pax dan pelayan, tambah item, simpan bill,
   tambah lagi, pisah bill bila perlu, bayar, kirim struk, stok berkurang, loyalty poin bertambah.
2. **Beli stok**: buat supplier, buat PO, fulfill, stok bertambah, biaya rata-rata ingredient diperbarui.
3. **Tutup shift**: hitung tunai, sistem menampilkan expected, kasir isi actual, selisih tercatat, rekap dicetak.
4. **Refund**: buka Aktivitas, pilih transaksi, pilih item dan alasan, stok dan laporan menyesuaikan.

## 6. Yang di-stub di versi 1

| Fitur | Perlakuan |
|---|---|
| Pembayaran digital | Metode tercatat, tombol "bayar" langsung sukses (mode simulasi) |
| Kirim SMS/email | Ditulis ke tabel `outbox`, tanpa pengiriman nyata |
| Printer | Pratinjau struk di layar, tombol cetak memakai `window.print()` |
| GoFood/Moka Order | Layar pengaturan saja, tanpa integrasi |
| Billing | Menampilkan status paket, tanpa pembayaran |

## 7. Paket langganan (referensi, opsional)

Batas yang terlihat di materi publik: Basic 5 karyawan/outlet, Pro 10, Enterprise 20;
database pelanggan 10.000 / 50.000 / tanpa batas. Untuk clone pribadi, seluruhnya bisa dimatikan
lewat satu konfigurasi `plan_limits`.

## 8. Kriteria selesai versi 1

- Dua outlet bisa dibuat, masing-masing dengan item, meja, dan karyawan sendiri.
- Satu alur transaksi dine-in dari buka meja sampai struk berjalan, termasuk pisah bill dan refund.
- Dashboard dan laporan Sales, Transactions, Shift menampilkan angka yang cocok dengan transaksi uji.
- Stok item dan ingredient berubah benar setelah jual, refund, PO, transfer, adjustment.
- Role "Cashier" tidak bisa membuka Back Office dan tidak bisa refund tanpa privilege.
