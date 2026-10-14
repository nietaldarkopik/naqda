# 04. Referensi Visual dan Struktur Menu

Dokumen ini merangkum **struktur menu** dan **tampilan** produk acuan, sebagai bahan desain untuk tim.

> **Catatan penggunaan.** Screenshot diambil dari video tutorial publik produk acuan dan hanya untuk
> **referensi riset internal**. Jangan dipublikasikan, dan jangan dipakai sebagai aset produk.
> Desain, ikon, warna, dan teks Naqdi harus dibuat sendiri. Watermark pada gambar milik pembuat video.

## 1. Struktur menu Back Office

```
Dashboard
  Summary | Outlet Comparison
Reports
  Sales
    Sales Summary · Gross Profit · Payment Methods · Sales Type · Item Sales
    Category Sales · Brand Sales · Modifier Sales · Discounts · Taxes · Gratuity · Collected By
  Transactions        (Success Orders | Cancelled Orders | Void Items)
  Invoices
  Shift
Library
  Item Library · Modifiers · Categories · Bundle Package · Promo
  Discounts · Taxes · Gratuity · Sales Type · Brands
Ingredient
  Ingredient Library · Ingredient Categories · Recipes (Item | Semi-Finished)
Inventory
  Summary · Suppliers · Purchase Order · Transfer · Adjustment
Online Channels
  Moka Order-style storefront · GoFood-style linking
Customers
  Customer List · Feedback · Loyalty Program
Employees
  Employee Slots · Employee Access (role) · PIN Access
Customer Display
Table Management
  Table Group · Table Map · Table Report
Partner Solutions · Capital                     (di luar versi 1)
Payments
  Mobile Payments · Payment Configuration
Account Settings
  Account · Billing · Outlets · Bank Account · Public Profile
  Receipt · Checkout · Inventory · Email Notification
```

Elemen tetap di setiap halaman: pemilih bisnis/outlet di kiri atas, banner langganan di atas,
tombol "Tutorials & Help" dan nomor bantuan di dasar sidebar.

### Contoh pola URL (untuk merancang rute)

| Area | Pola |
|---|---|
| Dashboard | `/dashboard` |
| Laporan | `/reports/sales/{summary \| payment_methods \| sales_type \| item_sales \| brand_sales \| modifier_sales}`, `/reports/transactions`, `/reports/invoices`, `/reports/shifts` |
| Library | `/library/{list \| modifier \| categories \| bundle-package \| promo \| discounts \| sales_type \| brands}` |
| Ingredient | `/ingredient/{list \| recipes}` |
| Inventory | `/inventory/{summary \| suppliers \| purchase_orders \| transfer \| adjustment}` |
| Customers | `/customers/{list \| feedback_list \| loyalty}` |
| Employees | `/employees/{staff \| role}` |
| Table | `/table-management/{group \| map \| report}` |
| Pengaturan | `/settings/{accounts \| billing \| receipt \| checkout \| inventory \| email}`, `/outlets/list` |

Naqdi tidak harus meniru URL ini; tabel ini hanya menunjukkan pengelompokan yang dipakai acuan.

## 2. Struktur menu aplikasi kasir

```
Menu samping (hamburger)
  Denah Meja
  Point of Sale
    Tab bawah: Favorit | Library | Custom
    Panel kanan: Tambah Pelanggan · Sales Type · Keranjang · Simpan Bill · Cetak Bill · Pisah Bill · Bayar
  Pesanan Online
  Aktivitas            (riwayat hari ini, kirim struk, refund)
  Inventori
  Shift                (Pilihan Shift · Shift Saat Ini · Histori Shift)
  Pengaturan
    Pesanan Online
    Pembayaran: Pembayaran · Pajak · Biaya Tambahan · Pengaturan Pembayaran
    Hardware: Printer · Barcode Scanner · EDC · Customer Display
    Akun: Bahasa · Profil · Bantuan · Keluar
```

Layout: tablet landscape. Kiri grid produk, kanan keranjang, bilah biru di bawah untuk tab,
header biru berisi nama outlet.

## 3. Pola antarmuka yang berulang

| Pola | Dipakai di | Catatan desain |
|---|---|---|
| Daftar di kiri + panel detail di kanan | Item, modifier, promo, diskon, transaksi, PO, role, supplier | Klik baris membuka panel tanpa pindah halaman |
| Filter atas: outlet, rentang tanggal, status, pencarian | Hampir semua laporan | Komponen filter bersama |
| Tombol primer biru di kanan atas ("Create ...", "Export") | Semua halaman daftar | Satu posisi konsisten |
| Modal pemilih dengan pencarian | Tambah item/ingredient ke bundle, PO, resep | Reuse satu komponen |
| Wizard bertahap (4 langkah) | Promo, loyalty | Indikator langkah + Next/Previous |
| Toggle ON/OFF + disclosure | Pengaturan checkout, modifier limit/stock | |
| Konfirmasi merah untuk aksi berisiko | Ubah item beresep, hapus | Dialog dengan penjelasan dampak |
| Badge status berwarna | Promo, PO, invoice, bill sync | Hijau aktif/selesai, merah tidak aktif/terlambat, oranye menunggu |
| "Save" dan "Save to All Outlets" berdampingan | Item, modifier, diskon | Inti dari multi-outlet |

## 4. Galeri Back Office

<div class="gallery">
<figure><img src="assets/screens/bo_dashboard.jpg"><figcaption>Dashboard: ringkasan penjualan, filter outlet dan tanggal, tab Summary/Outlet Comparison.</figcaption></figure>
<figure><img src="assets/screens/bo_outlet_compare.jpg"><figcaption>Outlet Comparison: kolom per outlet berdampingan, tombol + Add Outlet.</figcaption></figure>
<figure><img src="assets/screens/bo_sales_summary.jpg"><figcaption>Laporan Sales: sub-menu laporan di kiri, rincian gross sampai total collected di kanan.</figcaption></figure>
<figure><img src="assets/screens/bo_payment_methods.jpg"><figcaption>Sales: Payment Methods, dikelompokkan per jenis (cash, e-wallet, EDC, e-commerce).</figcaption></figure>
<figure><img src="assets/screens/bo_transactions.jpg"><figcaption>Transactions: daftar per hari, panel detail struk, Resend Receipt dan Issue Refund.</figcaption></figure>
<figure><img src="assets/screens/bo_invoice.jpg"><figcaption>Invoice: status Paid/Overdue, panel Invoice Activity, Record Payment.</figcaption></figure>
<figure><img src="assets/screens/bo_shift_report.jpg"><figcaption>Laporan Shift: waktu, akses, total expected, total actual, selisih.</figcaption></figure>
<figure><img src="assets/screens/bo_shift_detail.jpg"><figcaption>Detail shift: starting cash, cash sales, refunds, expected vs actual.</figcaption></figure>
<figure><img src="assets/screens/bo_item_library.jpg"><figcaption>Item Library: tabel dengan kategori, harga, stok, alert; Import/Export dan Create Item.</figcaption></figure>
<figure><img src="assets/screens/bo_item_sales_type.jpg"><figcaption>Form item: harga berbeda per sales type (Dine In, GrabFood, ShopeeFood, Take Away).</figcaption></figure>
<figure><img src="assets/screens/bo_modifiers.jpg"><figcaption>Modifiers: set modifier, opsi, dan "Apply Set to Item".</figcaption></figure>
<figure><img src="assets/screens/bo_bundle.jpg"><figcaption>Bundle Package: daftar, harga, outlet, status aktif.</figcaption></figure>
<figure><img src="assets/screens/bo_promo.jpg"><figcaption>Promo: periode, outlet, status Ongoing/Inactive; Create Promo membuka wizard.</figcaption></figure>
<figure><img src="assets/screens/bo_discounts.jpg"><figcaption>Discounts: nilai persen atau rupiah, jumlah outlet yang memakai.</figcaption></figure>
<figure><img src="assets/screens/bo_ingredient.jpg"><figcaption>Ingredient Library: stok, unit, dan penanda Out/Low pada Stock Alert.</figcaption></figure>
<figure><img src="assets/screens/bo_recipes.jpg"><figcaption>Recipes: pilih item dan varian, tambah ingredient dan jumlah, total biaya rata-rata.</figcaption></figure>
<figure><img src="assets/screens/bo_inv_summary.jpg"><figcaption>Inventory Summary: beginning, purchase order, sales, transfer, adjustment, ending.</figcaption></figure>
<figure><img src="assets/screens/bo_po.jpg"><figcaption>Purchase Order (Simple): daftar per hari, status Completed, Create PO.</figcaption></figure>
<figure><img src="assets/screens/bo_po_config.jpg"><figcaption>Pengaturan Inventory: pilih Simple atau Advanced Purchase Order.</figcaption></figure>
<figure><img src="assets/screens/bo_transfer.jpg"><figcaption>Transfer antar outlet: tab All Transfers, Approval, Shipment, Fulfillment.</figcaption></figure>
<figure><img src="assets/screens/bo_adjustment.jpg"><figcaption>Adjustment: toggle Item Library/Ingredients, Create Adjustment.</figcaption></figure>
<figure><img src="assets/screens/bo_customers.jpg"><figcaption>Customer List: member, non-member, poin, lifetime spending.</figcaption></figure>
<figure><img src="assets/screens/bo_loyalty.jpg"><figcaption>Loyalty Program: status, kuota member, konfigurasi, aturan poin.</figcaption></figure>
<figure><img src="assets/screens/bo_employee_access.jpg"><figcaption>Employee Access: role, jenis akses, jumlah privilege, editor checklist.</figcaption></figure>
<figure><img src="assets/screens/bo_table_map.jpg"><figcaption>Table Map: kanvas denah dengan meja yang bisa digeser, Add Table, Save Changes.</figcaption></figure>
<figure><img src="assets/screens/bo_table_report.jpg"><figcaption>Table Report: transaksi per meja, pax, durasi, panel detail.</figcaption></figure>
<figure><img src="assets/screens/bo_checkout.jpg"><figcaption>Pengaturan Checkout: pajak, gratuity, pembulatan, batas stok.</figcaption></figure>
<figure><img src="assets/screens/bo_payment_config.jpg"><figcaption>Payment Configuration: konfigurasi metode pembayaran per kelompok outlet.</figcaption></figure>
</div>

## 5. Galeri aplikasi kasir

<div class="gallery two">
<figure><img src="assets/screens/pos_main.jpg"><figcaption>Layar penjualan: grid produk, keranjang, tab Favorit/Library/Custom.</figcaption></figure>
<figure><img src="assets/screens/pos_menu.jpg"><figcaption>Menu samping: Denah Meja, POS, Pesanan Online, Aktivitas, Inventori, Shift, Pengaturan.</figcaption></figure>
<figure><img src="assets/screens/pos_modifier.jpg"><figcaption>Dialog item: varian, jumlah, diskon, tipe penjualan.</figcaption></figure>
<figure><img src="assets/screens/pos_cart.jpg"><figcaption>Pencarian Library dan keranjang dengan item dan modifier.</figcaption></figure>
<figure><img src="assets/screens/pos_pilih_meja.jpg"><figcaption>Pilih meja: denah per grup, Simpan Sebagai Bill atau Lanjutkan.</figcaption></figure>
<figure><img src="assets/screens/pos_denah.jpg"><figcaption>Denah Meja: meja terisi berwarna merah dengan total tagihan.</figcaption></figure>
<figure><img src="assets/screens/pos_daftar_bill.jpg"><figcaption>Daftar Bill: Open Bill, pembatalan bill, pembatalan produk, status sync.</figcaption></figure>
<figure><img src="assets/screens/pos_pisah_bill.jpg"><figcaption>Pisah Bill: pilih item dan jumlah yang dipisahkan.</figcaption></figure>
<figure><img src="assets/screens/pos_payment.jpg"><figcaption>Pembayaran: tunai dengan nominal cepat, e-wallet, Pisah Bayar.</figcaption></figure>
<figure><img src="assets/screens/pos_success.jpg"><figcaption>Sukses: kembalian, kirim struk email/SMS, cetak, transaksi baru.</figcaption></figure>
<figure><img src="assets/screens/pos_loyalty.jpg"><figcaption>Program Loyalty: saldo poin dan reward yang bisa ditukar.</figcaption></figure>
<figure><img src="assets/screens/pos_aktivitas.jpg"><figcaption>Aktivitas: riwayat hari ini dan rincian struk.</figcaption></figure>
<figure><img src="assets/screens/pos_refund.jpg"><figcaption>Pilih Refund: item, jumlah, alasan refund.</figcaption></figure>
<figure><img src="assets/screens/pos_online.jpg"><figcaption>Pesanan Online: daftar, filter, detail pesanan dan pengiriman.</figcaption></figure>
<figure><img src="assets/screens/pos_inventori.jpg"><figcaption>Inventori: stok per produk dan varian.</figcaption></figure>
<figure><img src="assets/screens/pos_shift_now.jpg"><figcaption>Shift Saat Ini: Akhiri Shift, Cetak Laporan, kas keluar/masuk.</figcaption></figure>
<figure><img src="assets/screens/pos_akhiri_shift.jpg"><figcaption>Akhiri Shift: saldo tunai, pembayaran, refund, uang yang diharapkan.</figcaption></figure>
<figure><img src="assets/screens/pos_printer.jpg"><figcaption>Pengaturan Printer: daftar printer dan tiket pesanan.</figcaption></figure>
</div>

## 6. Hal yang perlu diperhatikan dalam desain Naqdi

- Back Office padat data dan memakai banyak tabel; prioritaskan keterbacaan dan filter yang cepat.
- Tombol kasir besar dan ramah sentuh; jarak ketuk minimal sekitar 44 px.
- Warna status harus punya penanda kedua selain warna (ikon atau teks) agar mudah dibaca.
- Semua istilah di UI memakai glosarium yang konsisten di tiga bahasa (Indonesia, Inggris, Arab), mis. "Bill", "Pisah Bill".
- **Seluruh tangkapan layar acuan berarah kiri-ke-kanan.** Untuk bahasa Arab, tata letak harus dicerminkan
  (sidebar di kanan, kolom tabel dan wizard terbalik, ikon berarah dibalik); lihat doc 02 bagian 1c.
- Rancang komponen bersama sejak awal (filter, tabel master-detail, modal pemilih, wizard) supaya
  puluhan halaman tidak ditulis satu per satu.
