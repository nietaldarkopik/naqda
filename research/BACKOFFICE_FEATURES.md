# Moka Back Office: Daftar Fitur (dari tutorial 01–06)

Sumber: frame video di `sheets/vNN_MM.jpg` (1 frame per 30 detik, 6 frame per sheet).
Video 07–16 belum dianalisis (belum diunduh).
Catatan: ini dibaca dari tangkapan layar, bukan dari kode. Detail kecil perlu dicek ulang saat membangun.

## Navigasi sidebar Back Office
Dashboard · Reports (Sales, Transactions, Invoices, Shift) · Library (Item Library, Modifiers, Categories,
Bundle Package, Promo, Discounts, Taxes, Gratuity, Sales Type, Brands) · Ingredient (Ingredient Library,
Ingredient Categories, Recipes) · Inventory (Summary, Suppliers, Purchase Order, Transfer, Adjustment) ·
Online Channels (Moka Order, GoFood) · Customers · Employees · Customer Display · Table Management ·
Partner Solutions · Capital · Payments · Account Settings (Account, Billing, Outlets, Bank Account,
Public Profile, Receipt, Checkout, Inventory, Email Notification).
Header: pemilih bisnis/outlet, banner langganan, tombol "Tutorials & Help", hotline.

## 01 Dashboard (`/dashboard`, `/v2/dashboard`)
- Tab **Summary** dan **Outlet Comparison**.
- Filter: outlet (All Outlets atau satu outlet), rentang tanggal.
- Kartu Sales Summary: Gross Sales, Net Sales, Gross Profit, Transactions, Average Sale per Transaction, Gross Margin.
- Grafik: Daily Gross Sales (area), Day of the Week, Hourly Gross Sales (dengan tooltip).
- Item Summary: tabel Top Items (Item Sold, Gross Sales, Net Sales, Gross Profit).
- Category by Volume dan Category by Sales (pie chart), Top Items by Category (bar chart per kategori).
- Table Management summary: Total Pax, Avg Revenue per Pax, Avg Dine-in Time per Table.
- Outlet Comparison: kolom per outlet berdampingan, bisa "+ Add Outlet".

## 02 Laporan Penjualan (`/reports/...`)
- **Sales** punya sub-menu: Sales Summary, Gross Profit, Payment Methods, Sales Type, Item Sales
  (tab Income/Quantity, kolom a la carte vs bundle), Category Sales, Brand Sales, Modifier Sales,
  Discounts, Taxes, Gratuity, Collected By.
- Sales Summary: Gross Sales, Discounts, Refunds, Net Sales, Gratuity, Tax, Rounding, Total Collected.
- Tombol **Export** (CSV/Google Sheets) di semua laporan, ada filter outlet dan tanggal.
- **Transactions**: tab Success Orders, Cancelled Orders, Void Items. List per hari dengan total,
  panel detail struk (nomor, meja, kasir, item), tombol Resend Receipt dan Issue Refund, cari nomor struk.
- **Invoices**: tabel (Date, Invoice No, Outlet, Customer, Status Paid/Overdue/Due, Amount), filter status,
  panel Invoice Activity, tombol Resend, Record Payment, More.
- **Shift**: nama kasir, jam mulai dan selesai, akses/outlet, Total Expected, Total Actual, Difference.
  Detail memuat Starting Cash, Cash Sales, Cash Refunds, Expected Cash Payment, rincian pesanan online.

## 03 Library: produk, promo, diskon, bundling
- **Item Library** (`/library/list`): tabel (Name, Category, Pricing, In Stock, Stock Alert), filter outlet,
  kategori, inventory, dan pencarian. Import/Export (spreadsheet), Create Item.
  Form item: gambar, nama, kategori, brand, deskripsi, GoFood on/off, Moka Order pickup/delivery,
  varian (nama, harga, SKU), **harga berbeda per sales type** (Dine In, GrabFood, ShopeeFood, Take Away...),
  Track Inventory + Alert (per varian), COGS, pilihan modifier, Save / Save to All Outlets.
  Modifikasi item punya dialog konfirmasi (merah). Template impor memuat kolom harga per sales type dan modifier set.
- **Modifiers**: Modifier Set, daftar opsi dan harga, Modifier Limit, Modifier Stock
  (stok terhubung ke ingredient), "Apply Set to Item".
- **Categories**: daftar kategori dengan jumlah item, "Assign To Item".
- **Bundle Package**: nama, item (pilih varian), harga bundle, harga per sales type,
  outlet yang dipakai (Assign Outlet), status Active/Inactive, gambar, hapus.
- **Promo**: daftar (nama, periode, outlet, status Ongoing/Inactive). Tipe promo: Discount per Item,
  Free Item (beli X gratis Y), dan tipe lain. Wizard 4 langkah: Promo Information, Purchase Requirement
  (item atau salah satu item dari kategori, jumlah), Reward, Promo Configuration (berlaku kelipatan,
  periode tanggal, jam, hari). Assign outlet dan sales type.
- **Discounts**: nama, nilai (% atau Rp), fixed atau customizable di POS, assign outlet.
- **Taxes** dan **Gratuity** (service charge): nama, persen, assign outlet.
- **Sales Type**: nama, gratuity yang dikenakan, status aktif.
- **Brands**: nama brand dan jumlah item.

## 04 Ingredient dan COGS
- **Ingredient Library**: tabel (Name, Category, In Stock, Unit, Stock Alert Out/Low).
  Filter tipe ingredient, kategori, inventory. Tombol Create Ingredient (**Raw** atau **Semi-Finished**), Import/Export.
- Raw Ingredient: nama, kategori (bisa buat baru), unit (gram, ml, pcs, gallon...), track stok + alert, rata-rata biaya.
- Semi-Finished Ingredient: nama, unit, **Recipe** (bahan mentah + jumlah), tombol Produce (produksi ke stok),
  avg cost dihitung otomatis dari resep.
- **Recipes**: tab Item dan Semi-Finished. Pilih item, pilih varian, tambah ingredient + jumlah,
  Total Avg Cost, pengurangan stok otomatis.
- COGS: "Manage Cost of Goods Sold" per item/ingredient.
- Modifier Stock: tiap opsi modifier memotong ingredient dengan jumlah tertentu.

## 05 Inventory
- **Summary**: per outlet, kolom Beginning, Purchase Order, Sales, Transfer, Adjustment, Ending. Pilih periode, Export.
- **Suppliers**: tabel + form (nama, telepon, email, alamat, kota, kode pos).
- **Purchase Order** (Simple, toggle Item Library/Ingredients): tab All PO, Approval, Fulfillment.
  Create PO: outlet, supplier, catatan, tambah ingredient (qty, unit cost, subtotal), Create atau Create & Fulfill.
  Status: Waiting for Fulfillment, Completed. Email notifikasi PO, Print, Mark as Fulfilled, History Log.
  **Simple vs Advanced PO** dipilih di Account Settings > Inventory
  (Advanced: approval, shipment, partial fulfillment; Start Fulfillment dengan accepted/remaining).
- **Transfer** (Simple/Advanced): tab All Transfers, Approval, Shipment, Fulfillment. Create Transfer
  (outlet asal/tujuan, item, catatan), konfirmasi, Start Fulfillment (Received/Not Received).
- **Adjustment**: toggle Item Library/Ingredients. Create Adjustment: pilih item, In Stock, Actual Stock,
  selisih otomatis, catatan. Kartu ringkasan (jumlah adjustment, item, expense/income). Import/Export template.

## 06 Online Channels
- **Moka Order**: halaman promosi/upgrade, tombol Manage membuka situs `account.mygostore.com`
  (Brand Settings, Outlet Settings). Fitur Dine-in QR meja, Pick-up, Delivery. Katalog online per outlet.
- **GoFood**: tautkan outlet Moka ke akun GoFood (status integrasi, "Link to GoBiz"),
  sinkron menu dan item library, harga GoFood diatur lewat sales type.
- Daftar **Outlet** (`/outlets/list`), tambah outlet.

## Hal yang berulang di seluruh Back Office (jadi komponen bersama)
Filter outlet + rentang tanggal · tabel master-detail (klik baris, panel kanan) · Export/Import spreadsheet ·
modal pilih item/ingredient dengan pencarian · "Save to All Outlets" · status badge · toast sukses ·
konfirmasi destruktif · multi-outlet di tiap entitas.

## 07 Customers dan Loyalty (label "CRM Pro")
- **Customer List**: ringkasan (non-loyalty member, loyalty member, rewards redeemed), tabel
  (Name, Customer Since, Member Since, Points, Lifetime Spending), cari nama/email/telepon, Import/Export.
- **Feedback**: ringkasan good/bad feedback, filter outlet/karyawan/periode, percakapan per pelanggan
  dengan balasan dan struk terkait.
- **Loyalty Program**: toggle ON/OFF, kuota member, Edit/Reset Program. Wizard:
  (1) tipe poin: dari total belanja (Rp X = Y poin) atau dari pembelian item/kategori, plus poin bonus member baru;
  (2) daftar reward: tipe % diskon total, Rp diskon total, atau diskon item/kategori tertentu,
  dengan poin redeem, maksimum diskon, minimum pembelian;
  (3) konfigurasi: masa berlaku program, kode validasi via SMS untuk tiap redeem.

## 08 Employees
- **Employee Slots** (daftar karyawan): nama, role, outlet, tanggal kedaluwarsa slot, status, undangan (Invite).
- **Employee Access** (role): daftar role dengan jumlah karyawan, akses (App & Back Office / App Only / Back Office Only),
  jumlah privilege. Editor role berisi checklist hak akses (Manage Discounts, Issue Refunds,
  Table Reports, Payments, Mobile Payments, Manage Account Settings, Receipts, Email Notification, dst.).
- **PIN Access**: PIN 4 digit per karyawan.
- Role bawaan: Administrator, Cashier, Head Bar and Kitchen, Investor, Regional Sales Manager.

## 09 Table Management (Back Office)
- **Table Group** (Indoor, Outdoor): nama, status Active, jumlah meja.
- **Table Map**: kanvas denah, Add Table, tiap meja punya nama + kapasitas pax, bisa digeser,
  Edit/Delete, Save Changes, pilih outlet dan grup.
- **Table Report**: tab Transaction dan Void Items, kartu Completed/Cancelled Orders,
  tabel (Date, Receipt, Served By, Pax, Duration, Status), panel detail.

## 10 Account Settings
- **Account**: data pribadi dan data bisnis (nama, telepon/email terverifikasi, alamat, provinsi).
- **Billing**: outlet aktif + tanggal kedaluwarsa, siklus tagihan, kupon, Total, Pay, Billing History.
- **Outlets**: daftar outlet (status, alamat, telepon, GoBiz Linking), Add Outlet.
- **Bank Account**, **Public Profile**.
- **Receipt**: info struk (logo, alamat, sosmed, catatan) + preview langsung.
- **Checkout**: toggle Tax, Gratuity, harga sudah/belum termasuk pajak, Rounding (digit pembulatan),
  Stock Limit (+ Allow Override), Track Server, Split Payment, Save Bill dan Print Bill.
- **Inventory**: pilih Simple vs Advanced untuk PO, Transfer, Adjustment.
- **Email Notification**: ringkasan penjualan harian, peringatan stok, promo update, daftar penerima.
- **Payments**: Mobile Payments, **Payment Configuration** (nama konfigurasi, outlet,
  metode: Cash, E-wallet, Online Delivery, EDC, Bank Transfer, Gift Card, dst.).

## 11 Aplikasi kasir: pengaturan awal (tablet Android, bahasa Indonesia)
- Daftar/masuk (nama KTP, telepon, email, kata sandi, kode referral).
- Menu samping: **Denah Meja, Point of Sale, Pesanan Online, Aktivitas, Inventori, Shift, Pengaturan**.
- Pengaturan: Pesanan Online (terima pesanan, bunyi notifikasi), Pembayaran (e-wallet status Approved/Inactive),
  Pajak, Biaya Tambahan, Pengaturan Pembayaran (harga sudah/belum termasuk pajak),
  Hardware (Printer, Barcode Scanner, EDC, Customer Display), Akun (Bahasa, Profil, Bantuan, Keluar).
- Printer: Bluetooth, cetak struk/bill, tiket pesanan per produk/saat bayar, label stiker.
- Shift: Pilihan Shift (mulai otomatis + saldo awal laci), Shift Saat Ini (Akhiri Shift, Cetak Laporan,
  Kas Keluar/Kas Masuk), Histori Shift.

## 12 Aplikasi kasir: transaksi
- Layar POS: grid produk (tab **Favorit**, **Library**, **Custom** keypad nominal), panel keranjang di kanan:
  Tambah Pelanggan, pilih tipe penjualan (Dine In/Take Away/GoFood/...), daftar item, subtotal,
  pajak + biaya tambahan, **Simpan Bill**, **Cetak Bill**, **Pisah Bill**, tombol **Bayar Rp X**.
- Favorit bisa diatur (produk di-drag/hapus, halaman produk). Cari produk di Library.
- Dialog item: varian, modifier (pilih satu/banyak), jumlah, diskon, tipe penjualan per item, catatan.
  Harga mengikuti sales type.
- **Daftar Bill**: tab Open Bill, Pembatalan Bill, Pembatalan Produk; kolom meja, grup, pelayan, waktu, sync.
- **Pisah Bill** (pilih item + qty), **Pisah Bayar** (bayar dengan beberapa metode).
- Pembayaran: Tunai (nominal cepat), E-wallet (GoPay, OVO, DANA, LinkAja, ShopeePay, Kredivo), QRIS,
  EDC, bank transfer, dll. Layar sukses: kembalian, kirim struk email/SMS, cetak struk, Transaksi Baru.

## 13 dan 14: Denah meja dan pelanggan (kasir)
- **Denah Meja**: tab grup (Indoor/Outdoor) dengan jumlah terisi/total, meja kosong vs terisi (warna + total),
  pilih meja untuk bill baru (isi pax, pilih pelayan/server), Proses Ulang, Daftar Bill.
- **Tambah Pelanggan**: nama, telepon (wajib), email, tanggal lahir.
- **Program Loyalty** di kasir: cek/daftar member via telepon, bonus poin member baru, saldo poin,
  daftar reward yang bisa diredeem, kode validasi 6 digit via SMS, diskon masuk ke struk.

## 15 dan 16: Pesanan online, aktivitas, refund, shift
- **Pesanan Online**: daftar pesanan (Moka Order/GoFood) dengan filter tampilan dan metode pengiriman,
  status (Selesai, Pickup Kedaluwarsa), detail pesanan dan pengiriman, ID order.
- **Aktivitas**: riwayat transaksi hari ini + cari nomor struk, detail lengkap, **Kirim Struk**, **Pilih Refund**
  (pilih item + qty, alasan refund, jumlah refund otomatis termasuk pajak).
- **Inventori** (kasir): lihat stok per produk/varian, cari, pilih Library Produk.
- **Shift**: Produk Terjual, Produk Refund, **Akhiri Shift** (saldo tunai, pembayaran tunai, uang tunai dari invoice,
  refund tunai, kas masuk/keluar, uang yang diharapkan, hitung uang aktual lalu selisih), Cetak Rekap Laporan Shift.

## Belum dicakup / perlu dicek
- Detail layar yang tidak muncul di frame 30 detik (misalnya dialog singkat).
- Fitur yang tidak ada di tutorial: Capital, Partner Solutions, Customer Display, Bank Account, Public Profile.
