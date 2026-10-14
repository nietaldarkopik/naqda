# 05. Menjalankan Naqdi (tanpa Docker, dengan Docker opsional)

Naqdi hanya membutuhkan **Node.js 20+** dan **MySQL 8.4** (8.0 juga seharusnya bisa). Docker tidak wajib.
Jalur yang **sudah diuji**: Windows 11, Node 25, MySQL 8.4.7 terpasang langsung (lewat WampServer).
Jalur Docker dan Linux/macOS belum diuji.

## 1. Prasyarat

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | 20 atau lebih baru | `node -v` |
| MySQL | 8.4 (minimal 8.0) | MariaDB tidak diuji; `npm run doctor` memberi peringatan |
| Redis | tidak perlu | Hanya bila `QUEUE_DRIVER=redis` |

Memasang MySQL tanpa Docker:
- **Windows**: MySQL Installer resmi, atau paket seperti WampServer/Laragon/XAMPP (pastikan versi MySQL, bukan hanya MariaDB).
- **macOS**: `brew install mysql@8.4` lalu `brew services start mysql@8.4`.
- **Ubuntu/Debian**: pasang `mysql-server` dari repositori resmi MySQL (paket bawaan distro sering 8.0).

Akun `root` tanpa kata sandi hanya untuk pengembangan lokal. Di server sungguhan, buat pengguna khusus
dengan hak penuh hanya pada database `naqdi`.

## 2. Langkah cepat

```bash
npm run setup     # membuat .env, memasang dependensi, membuat database, migrasi, data demo
npm run dev       # API di http://127.0.0.1:4000, web di http://localhost:3000
npm run doctor    # periksa lingkungan kapan saja
```

`npm run setup` aman diulang: `.env` yang sudah ada tidak diubah, database yang sudah ada tidak dihapus,
dan data demo tidak digandakan.

Akun demo (hanya pengembangan):

| Peran | Email | Kata sandi | Masuk Back Office |
|---|---|---|---|
| Administrator | `admin@naqdi.test` | `Naqdi123!` | Ya |
| Kasir | `kasir@naqdi.test` | `Naqdi123!` | Tidak (peran khusus aplikasi kasir) |

## 3. Konfigurasi (`.env`)

Semua pengaturan lewat variabel lingkungan; contoh lengkap ada di `.env.example`. Yang penting:

| Variabel | Bawaan | Arti |
|---|---|---|
| `DATABASE_URL` | `mysql://root:@127.0.0.1:3306/naqdi` | Alamat database. Ubah port bila MySQL Anda bukan di 3306 |
| `TEST_DATABASE_URL` | `.../naqdi_test` | Database tes; **isinya dihapus** setiap tes dijalankan, jadi nama harus berakhiran `_test` |
| `API_HOST`, `API_PORT` | `127.0.0.1`, `4000` | Alamat server API |
| `JWT_SECRET` | dibuat acak oleh `npm run setup` | Minimal 32 karakter. **Wajib diganti di produksi** (API menolak start di produksi bila masih nilai contoh) |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Asal yang boleh memanggil API langsung (klien desktop/mobile) |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` | Alamat API yang dipanggil server Next |
| `QUEUE_DRIVER` | `db` | `db` (tanpa Redis) atau `redis` |
| `STORAGE_DIR` | `./storage` | Folder gambar unggahan (driver `local`). **Ikut dicadangkan** bersama database; hilangnya folder ini berarti gambar item hilang |

Port MySQL yang dipakai di mesin Anda bisa berbeda. Bila `DATABASE_URL` tidak cocok, `npm run doctor` akan melaporkannya.

## 4. Perintah

| Perintah | Fungsi |
|---|---|
| `npm run setup` | Menyiapkan semuanya dari repo bersih |
| `npm run dev` | API + web dengan muat ulang otomatis |
| `npm run doctor` | Memeriksa Node, `.env`, MySQL, migrasi, port |
| `npm test` | Seluruh tes (butuh MySQL; memakai database `naqdi_test`) |
| `npm run typecheck` | Pemeriksaan tipe backend dan paket bersama |
| `npm run build` | Pemeriksaan tipe + build web produksi |
| `npm run db:generate` | Membuat berkas migrasi dari perubahan skema |
| `npm run db:migrate` | Menjalankan migrasi (membuat database bila belum ada) |
| `npm run db:seed` | Data demo (ditolak di produksi tanpa `--force`) |
| `npm run db:reset -- --yes` | **Menghapus** database kerja lalu membuatnya ulang (hanya pengembangan) |

Pemeriksaan tipe web terpisah: `cd apps/web && npx tsc --noEmit`.

## 5. Produksi tanpa Docker

1. Siapkan server dengan Node 20+ dan MySQL 8.4. Buat database dan pengguna khusus.
2. Isi `.env` produksi: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` acak, `CORS_ORIGINS`, `API_HOST=127.0.0.1`.
3. `npm ci` di root dan di `apps/web`, lalu `npm run db:migrate` dan `npm run build`.
4. Jalankan dua proses dengan pengelola proses, misalnya pm2:
   ```bash
   pm2 start "npx tsx apps/api/src/server.ts" --name naqdi-api
   pm2 start "npx next start -p 3000" --name naqdi-web --cwd apps/web
   pm2 save
   ```
   Atau buat dua unit systemd dengan perintah yang sama.
5. Pasang reverse proxy (Caddy atau Nginx) yang menerima HTTPS dan meneruskan semuanya ke web (`:3000`).
   Web meneruskan `/api/v1/*` ke API, sehingga browser hanya bicara ke satu asal dan cookie sesi berfungsi.
6. Cadangan: jadwalkan `mysqldump --single-transaction naqdi > naqdi-$(date +%F).sql` lewat cron/Task Scheduler,
   dan uji pemulihannya.

## 6. Dengan Docker (opsional, belum diuji)

```bash
docker compose up -d                       # hanya MySQL
npm run setup && npm run dev               # aplikasi tetap berjalan di mesin Anda
docker compose --profile app up -d --build # atau seluruh aplikasi di kontainer
```

Bila port 3306 sudah dipakai MySQL lain, jalankan dengan `MYSQL_HOST_PORT=3307` dan ubah port di `DATABASE_URL`.
Di dalam jaringan Compose database dijangkau dengan nama layanan `mysql`; nilai itu hanya ada di `docker-compose.yml`,
tidak pernah menjadi nilai bawaan aplikasi.

## 7. Masalah umum

| Gejala | Penyebab dan solusi |
|---|---|
| `ECONNREFUSED` ke MySQL | Layanan MySQL belum menyala, atau port di `DATABASE_URL` salah. Jalankan `npm run doctor` |
| `Access denied for user` | Kata sandi di `DATABASE_URL` salah. Format: `mysql://USER:PASSWORD@HOST:PORT/DB` (karakter khusus di-URL-encode) |
| Peringatan "Slow filesystem" dari Next | Proyek ada di drive exFAT/jaringan. Hanya memperlambat mode dev |
| `npm install` gagal dengan "Incorrect function" | Drive exFAT tidak mendukung symlink. Proyek ini sengaja tidak memakai pnpm/workspace symlink, jadi gunakan `npm`, bukan `pnpm` |
| Login web berhasil tetapi sesi hilang saat reload | Web diakses lewat host berbeda dari yang di-proxy. Buka lewat `http://localhost:3000` dan pastikan `/api/v1` di-proxy (bawaan Next) |
| API menolak start: "Tabel berikut bukan InnoDB" | MySQL Anda memakai MyISAM sebagai bawaan (umum di paket WAMP/XAMPP lama). Di pengembangan: `npm run db:reset -- --yes && npm run db:migrate && npm run db:seed`. Tetapkan juga `default-storage-engine=InnoDB` di `my.ini` |
| Port 3000 atau 4000 terpakai | Hentikan proses lain, atau ubah `API_PORT` / jalankan Next dengan port lain |
| Tes gagal "TEST_DATABASE_URL harus berakhiran _test" | Pengaman agar tes tidak menghapus database kerja. Perbaiki nama database tes |
