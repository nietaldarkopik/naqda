# 06. Contoh perhitungan untuk diverifikasi akuntan

> **Dokumen ini DIHASILKAN OTOMATIS** oleh `npm run docs:tax-examples` dari mesin hitung yang sama dengan yang dipakai kasir dan server
> (`packages/domain`). Jangan diedit tangan; ubah skenario di `scripts/tax-examples.ts`. Tujuannya: akuntan atau konsultan pajak dapat
> memeriksa **angkanya** tanpa membaca kode. **Belum ada verifikasi profesional**; dokumen ini adalah bahan untuk itu.

## Aturan yang diterapkan

1. Harga baris = harga satuan (sudah termasuk modifier) x jumlah.
2. Diskon baris (persen atau nominal), lalu promo otomatis, lalu diskon pesanan. Hasilnya **B** (harga setelah diskon). Cara menggabung tiga diskon ini diatur per outlet:
   *berurutan* (tiap diskon dari sisa), *kombinasi* (persen dihitung dari harga awal lalu dijumlahkan, maksimal sampai nol), atau *salah satu* (satu baris hanya menerima diskon terbesar).
3. Dari B diturunkan **N** (nilai barang sebelum pajak dan service). Service charge **G** = tarif x N. Pajak barang = tarif x N. Pajak atas service = tarif x G (bila "pajak atas service" aktif).
4. Bila harga menu **sudah termasuk** pajak (atau service), komponen itu dipisahkan dari B dan total tidak bertambah; bila **belum**, ditambahkan di atas B.
5. Pembulatan akhir ke kelipatan yang diatur outlet (terdekat/atas/bawah), dicatat terpisah sebagai **Pembulatan**; setengah dibulatkan ke atas.
6. Semua angka bilangan bulat dalam satuan terkecil (rupiah: rupiah; dolar dan riyal: sen dan halala). Persen dalam basis point (10% = 1000), dihitung dengan bilangan bulat tanpa pecahan desimal; sisa pembulatan antar-pajak masuk ke pajak terakhir.

## Pertanyaan untuk akuntan

- Apakah dasar pengenaan pajak (**N**) sesuai: setelah diskon, sebelum service? Apakah pajak boleh dikenakan atas service charge di yurisdiksi Anda?
- Apakah pembulatan boleh dimasukkan sebagai baris terpisah dan di mana dicatat pada pembukuan (pendapatan lain-lain)?
- Untuk harga **termasuk pajak**: apakah pemisahan pajak (harga x tarif / (100% + tarif)) dan pembulatannya sesuai?
- Apakah diskon pesanan mengurangi dasar pajak seluruhnya (sebagaimana di sini) atau ada aturan khusus?
- Apakah struk memuat semua unsur wajib (nomor pajak, nomor struk berurutan, rincian pajak, tanggal)?
- Untuk **refund**: pajak dan service dikembalikan sebanding bagian yang di-refund (lihat `docs/03-roadmap.md`); apakah ini sesuai?

## Skenario

### A. Rupiah, restoran: PB1 10% + service 5% (harga di luar pajak), pembulatan Rp 100

Pola umum restoran Indonesia. Pajak juga dikenakan atas service charge.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Nasi Goreng | Rp 28.000 | 2 | - |
| Es Teh | Rp 8.000 | 2 | - |

Pengaturan: harga **di luar** pajak; pembulatan ke kelipatan Rp 100 (terdekat).

**Hasil**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 72.000 |
| Harga setelah diskon (B) | Rp 72.000 |
| Nilai barang sebelum pajak dan service (N) | Rp 72.000 |
| Service 5% | Rp 3.600 |
| PB1 10% | Rp 7.560 |
| Pembulatan | +Rp 40 |
| **Total yang dibayar pelanggan** | **Rp 83.200** |

### B. Rupiah, PPN 11% sudah termasuk di harga menu

Harga yang dilihat pelanggan sudah mengandung pajak; pajak DIPISAHKAN dari harga, total tidak bertambah.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Kopi | Rp 22.000 | 3 | - |

Pengaturan: harga **sudah termasuk** pajak; tanpa pembulatan.

**Hasil**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 66.000 |
| Harga setelah diskon (B) | Rp 66.000 |
| Nilai barang sebelum pajak dan service (N) | Rp 59.459 |
| PPN 11% | Rp 6.541 |
| **Total yang dibayar pelanggan** | **Rp 66.000** |

### C. Diskon: baris 20% + diskon pesanan 10%, tiga cara menggabung

Cara gabung diskon diatur per outlet. Pajak dihitung dari harga SETELAH semua diskon.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Kopi | Rp 20.000 | 2 | 20% |
| Teh | Rp 10.000 | 1 | - |

Pengaturan: diskon pesanan 10%; harga **di luar** pajak; tanpa pembulatan.

**Cara gabung diskon: berurutan**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 50.000 |
| Diskon (baris + pesanan) | −Rp 12.200 |
| Harga setelah diskon (B) | Rp 37.800 |
| Nilai barang sebelum pajak dan service (N) | Rp 37.800 |
| PPN 11% | Rp 4.158 |
| **Total yang dibayar pelanggan** | **Rp 41.958** |

**Cara gabung diskon: kombinasi**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 50.000 |
| Diskon (baris + pesanan) | −Rp 13.000 |
| Harga setelah diskon (B) | Rp 37.000 |
| Nilai barang sebelum pajak dan service (N) | Rp 37.000 |
| PPN 11% | Rp 4.070 |
| **Total yang dibayar pelanggan** | **Rp 41.070** |

**Cara gabung diskon: salah satu**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 50.000 |
| Diskon (baris + pesanan) | −Rp 9.000 |
| Harga setelah diskon (B) | Rp 41.000 |
| Nilai barang sebelum pajak dan service (N) | Rp 41.000 |
| PPN 11% | Rp 4.510 |
| **Total yang dibayar pelanggan** | **Rp 45.510** |

### D. Dolar AS: sales tax 8,25% di luar harga, pembulatan tunai ke 5 sen

Toko luar negeri dengan dua desimal. Pembulatan 5 sen dicatat terpisah dari pajak.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Latte | $12.37 | 2 | - |
| Muffin | $3.45 | 1 | - |

Pengaturan: harga **di luar** pajak; pembulatan ke kelipatan $0.05 (terdekat).

**Hasil**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | $28.19 |
| Harga setelah diskon (B) | $28.19 |
| Nilai barang sebelum pajak dan service (N) | $28.19 |
| Sales tax 8.25% | $2.33 |
| Pembulatan | −$0.02 |
| **Total yang dibayar pelanggan** | **$30.50** |

### E. Riyal Saudi: VAT 15% di luar harga

Dua desimal (halala). Setengah ke atas pada pajak.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Karak | SAR 12.50 | 3 | - |

Pengaturan: harga **di luar** pajak; tanpa pembulatan.

**Hasil**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | SAR 37.50 |
| Harga setelah diskon (B) | SAR 37.50 |
| Nilai barang sebelum pajak dan service (N) | SAR 37.50 |
| VAT 15% | SAR 5.63 |
| **Total yang dibayar pelanggan** | **SAR 43.13** |

### F. Riyal Saudi: VAT 15% sudah termasuk di harga

Harga rak sudah termasuk VAT, umum di Arab Saudi.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Karak | SAR 12.50 | 3 | - |

Pengaturan: harga **sudah termasuk** pajak; tanpa pembulatan.

**Hasil**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | SAR 37.50 |
| Harga setelah diskon (B) | SAR 37.50 |
| Nilai barang sebelum pajak dan service (N) | SAR 32.61 |
| VAT 15% | SAR 4.89 |
| **Total yang dibayar pelanggan** | **SAR 37.50** |

### G. Dua pajak sekaligus (5% dan 6%) dengan dolar Singapura

Beberapa pajak berlaku bersamaan; sisa pembulatan masuk ke pajak terakhir agar jumlah per pajak cocok dengan total.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Set A | SGD 19.99 | 3 | - |

Pengaturan: harga **di luar** pajak; tanpa pembulatan.

**Hasil**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | SGD 59.97 |
| Harga setelah diskon (B) | SGD 59.97 |
| Nilai barang sebelum pajak dan service (N) | SGD 59.97 |
| Pajak 1 5% | SGD 3.00 |
| Pajak 2 6% | SGD 3.60 |
| **Total yang dibayar pelanggan** | **SGD 66.57** |

### H. Arah pembulatan Rp 1.000: terdekat, ke atas, ke bawah

Aturan pembulatan berbeda per toko. Selisih dicatat di baris Pembulatan.

Isi pesanan:

| Barang | Harga satuan | Jumlah | Diskon baris |
|---|---:|---:|---|
| Roti | Rp 15.400 | 1 | - |

Pengaturan: harga **di luar** pajak; pembulatan ke kelipatan Rp 1.000 (terdekat).

**Pembulatan: terdekat**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 15.400 |
| Harga setelah diskon (B) | Rp 15.400 |
| Nilai barang sebelum pajak dan service (N) | Rp 15.400 |
| PPN 11% | Rp 1.694 |
| Pembulatan | −Rp 94 |
| **Total yang dibayar pelanggan** | **Rp 17.000** |

**Pembulatan: ke atas**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 15.400 |
| Harga setelah diskon (B) | Rp 15.400 |
| Nilai barang sebelum pajak dan service (N) | Rp 15.400 |
| PPN 11% | Rp 1.694 |
| Pembulatan | +Rp 906 |
| **Total yang dibayar pelanggan** | **Rp 18.000** |

**Pembulatan: ke bawah**

| Langkah | Jumlah |
|---|---:|
| Subtotal (harga x jumlah) | Rp 15.400 |
| Harga setelah diskon (B) | Rp 15.400 |
| Nilai barang sebelum pajak dan service (N) | Rp 15.400 |
| PPN 11% | Rp 1.694 |
| Pembulatan | −Rp 94 |
| **Total yang dibayar pelanggan** | **Rp 17.000** |

---

Dihasilkan dengan `computeOrder` (packages/domain/src/order.ts). Tes otomatisnya ada di `packages/domain/test/` dan `apps/api/test/` (termasuk
paritas antara kasir offline dan server).
