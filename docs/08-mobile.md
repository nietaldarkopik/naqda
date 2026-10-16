# Aplikasi mobile (Android): kasir Naqdi

Status: **kerangka dan perangkat lunak sisi web selesai dan teruji; APK belum pernah dibangun atau dijalankan di perangkat.** Mesin pengembangan ini tidak punya JDK maupun Android SDK, jadi langkah yang butuh keduanya (membangun APK, menjalankan di tablet, mencoba printer Bluetooth) belum bisa diverifikasi. Bagian 5 menyebut persis apa yang sudah dan belum terbukti.

## 1. Arsitektur

- **Pembungkus Capacitor 7** (`apps/mobile`): aplikasi Android berisi WebView yang memuat kasir (`/id/pos`) dari server. Kode kasir tetap satu (`apps/web`), jadi fitur baru sampai ke tablet tanpa merilis ulang APK; APK hanya dirilis ulang bila bagian native berubah (plugin, izin, ikon).
- **Offline**: service worker kasir (v2) menyimpan halaman dan katalog setelah pemuatan pertama, penjualan masuk antrean IndexedDB dan disinkronkan lewat `/pos/sync`. Konsekuensi: **tablet butuh internet satu kali** untuk pemuatan pertama dan aktivasi perangkat. WebView aplikasi menyimpan IndexedDB lebih awet daripada tab browser. `LocalStore` SQLite yang ada di rencana Fase 11 belum dibuat; IndexedDB dipakai dulu.
- **Adapter perangkat keras** (`packages/hardware`, antarmuka `Hardware`): kode UI hanya memanggil `getHardware()`; adapter `capacitor` (printer Bluetooth, kamera) dimuat malas hanya di aplikasi native, jadi bundel web biasa tidak berubah. Cangkang lain (mis. Tauri untuk desktop kelak) cukup menyuntikkan `window.__NAQDI_HARDWARE__`.
- **Cetak struk = gambar**: struk di layar (`ReceiptView`) digambar ke canvas, diubah ke bitmap 1-bit, dikirim sebagai perintah raster ESC/POS (`GS v 0`, per pita 128 baris, lalu maju dan potong). Dengan begitu **huruf Arab dan aksara apa pun tercetak sama seperti di layar** tanpa tabel karakter printer, dan tidak ada dua desain struk yang harus dijaga. Lebar: 58 mm = 384 titik, 80 mm = 576 titik (mengikuti Desain Struk). Encoder dan konversi bitmap murni dan diuji (`packages/hardware/test`).
- **Pemindai**: scanner USB/Bluetooth mode keyboard tetap jalan (`useBarcodeScanner`); di aplikasi ada tombol **Pindai dengan kamera** (Google Code Scanner/ML Kit, tanpa izin kamera karena antarmukanya milik Google Play services; modul diunduh otomatis sekali).
- **Plugin**: `capacitor-thermal-printer` 0.2.5 (hanya perlu menerima byte mentah lewat `raw()`; mudah diganti bila bermasalah, cukup ubah `apps/web/src/lib/hardware/capacitor.ts`) dan `@capacitor-mlkit/barcode-scanning` 7.5. Plugin printer mensyaratkan Capacitor 7, karena itu seluruh tumpukan memakai Capacitor 7, bukan 8.

## 2. Membangun APK (di komputer yang punya Android Studio)

1. Pasang **Android Studio** (membawa JDK 21) dan, dari SDK Manager, **Android SDK Platform 35** + Build-Tools.
2. Pastikan server dapat diakses dari tablet lewat **HTTPS** (mis. `https://naqdi.excoder.site`); service worker offline tidak berjalan di HTTP.
3. Di folder repo:
   ```
   cd apps/mobile
   npm install
   NAQDI_URL=https://naqdi.excoder.site npm run sync     # PowerShell: $env:NAQDI_URL="..."; npm run sync
   npm run open                                          # membuka proyek di Android Studio
   ```
4. Di Android Studio: sambungkan tablet (Opsi pengembang > Debug USB) lalu **Run**. Atau dari terminal: `cd android && ./gradlew assembleDebug`, APK ada di `android/app/build/outputs/apk/debug/app-debug.apk` (pasang dengan `adb install`).
5. Debug WebView dari Chrome desktop (`chrome://inspect`): sinkronkan dengan `NAQDI_DEBUG=1`.

Pasang di tablet lalu: **aktifkan perangkat** dengan kode dari Back Office (alur yang sama dengan browser), pasangkan printer di **Pengaturan Android > Bluetooth**, lalu di kasir buka tombol **Printer** (ikon printer di bilah atas): Cari printer, Pilih, Tes cetak, dan atur cetak otomatis dan laci kas. Pilihan disimpan per tablet.

## 3. Rilis ke Google Play

- Buat **akun pengembang Google Play** (biaya sekali bayar) dan aplikasi baru di Play Console.
- **`appId` (`id.naqdi.kasir`) permanen setelah unggahan pertama.** Ubah dulu di `apps/mobile/capacitor.config.ts` bila perlu (lalu `npx cap sync`; ubah juga `namespace`/`applicationId` di `android/app/build.gradle` dan folder paket `MainActivity.java`, atau hapus `android/` dan jalankan `npx cap add android` lagi lalu ulangi pengaturan manifest/ikon di commit riwayat).
- Buat **keystore penandatangan** (`keytool -genkey ...`), simpan aman dan cadangkan: kehilangannya berarti tidak bisa memperbarui aplikasi. Disarankan **Play App Signing**.
- Bangun **AAB**: `cd android && ./gradlew bundleRelease`, tandatangani, unggah ke jalur **Internal testing** dulu.
- Syarat Play yang harus disiapkan: **URL kebijakan privasi** (dokumen hukum resmi belum ada; lihat docs/07), formulir **Keamanan data**, rating konten, tangkapan layar tablet.
- Naikkan `versionCode` di `android/app/build.gradle` setiap unggahan.
- **Langganan lewat Google Play** (bila kelak dijual di dalam aplikasi): lihat docs/07, bagian 12D-2. Belum dibuat; kebijakan dan komisi Google harus diperiksa saat itu.
- iOS: butuh Mac dan akun Apple Developer; belum dikerjakan.

## 4. Izin Android

`INTERNET`, `ACCESS_NETWORK_STATE`; Bluetooth: `BLUETOOTH_SCAN` (flag `neverForLocation`) dan `BLUETOOTH_CONNECT` untuk Android 12+, serta `BLUETOOTH`, `BLUETOOTH_ADMIN`, dan `ACCESS_FINE_LOCATION` hanya sampai Android 11. Kamera dan Bluetooth ditandai tidak wajib, jadi tablet tanpa keduanya tetap bisa memasang aplikasi. `allowBackup` dimatikan agar data kasir tidak ikut cadangan otomatis ke akun Google.

## 5. Yang sudah dan belum terbukti

Terbukti (otomatis, bisa diulang):
- Encoder ESC/POS, konversi bitmap, pemotongan baris putih, pemecahan pita (`npm test`, 14 tes).
- Alur kasir di dalam cangkang **simulasi** (`node tools/verify_native.mjs`): tombol printer dan kamera hanya muncul di cangkang, pindai kamera menambah item, pilih printer, uji cetak, byte yang dikirim (ESC @, `GS v 0` selebar 72 byte untuk 80 mm, tidak kosong, diakhiri potong), cetak otomatis setelah bayar, cetak manual, pesan galat ramah saat printer gagal, pilihan tersimpan. Hasil raster dibaca balik menjadi gambar dan dicek mata: struk Latin dan teks Arab terbaca jelas.
- Proyek Android dihasilkan oleh `cap add android` dan `cap sync` mengenali kedua plugin.

**Belum terbukti dan harus dicoba di perangkat nyata sebelum dipakai toko:**
1. Proyek Gradle benar-benar terbangun (belum pernah dikompilasi; JDK/SDK tidak ada di mesin ini).
2. `capacitor-thermal-printer` 0.2.5 (versi awal, satu pengelola) berhasil menyambung ke printer 58 mm yang umum (RPP02N, Xprinter) dan menerima byte raster mentah lewat `raw()`: kecepatan, pemotongan data besar, dan sambung ulang setelah printer tidur. Plugin harus meminta izin Bluetooth saat runtime di Android 12+; bila tidak, perlu ditambah permintaan izin sendiri.
3. WebView memuat kasir dari server, service worker aktif, dan **kasir tetap berjalan setelah peluncuran dingin tanpa internet** (pemuatan pertama online lebih dulu).
4. `html-to-image` merender struk benar di WebView Android (font, RTL).
5. Google Code Scanner (butuh Google Play services; tablet tanpa layanan Google tidak mendukung).

Bila item 2 gagal, alternatif: plugin Bluetooth klasik lain, atau menulis plugin Capacitor kecil sendiri (Java, `BluetoothSocket` SPP) yang hanya menerima array byte, tanpa mengubah satu baris pun di sisi web.
