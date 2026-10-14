# Naqdi

Aplikasi kasir (POS) multi-outlet untuk F&B dan retail, dengan Back Office web dan kasir yang kelak
dibungkus untuk desktop dan mobile. Bahasa: Indonesia, Inggris, Arab (RTL).

Status: **Fase 0 (fondasi) dan Fase 1 (katalog) inti selesai**, dengan sisa yang tercatat di `docs/03-roadmap.md`.
Kasir, stok, dan laporan dibangun di fase berikutnya. Untuk bisnis nyata ada daftar syarat sebelum dipakai di toko
(roadmap, bagian "Syarat bisnis nyata").

## Mulai cepat

Butuh Node.js 20+ dan MySQL 8.4. Docker **tidak** wajib.

```bash
npm run setup     # .env, dependensi, database, migrasi, data demo
npm run dev       # API http://127.0.0.1:4000, web http://localhost:3000
npm run doctor    # periksa lingkungan
npm test          # tes (memakai database naqdi_test)
```

Masuk ke http://localhost:3000 dengan `admin@naqdi.test` / `Naqdi123!` (hanya data demo pengembangan).
Panduan lengkap, produksi, dan Docker opsional: `docs/05-menjalankan-tanpa-docker.md`.

## Struktur

```
apps/api/        Server API (Hono + Node, /api/v1)
apps/web/        Back Office (Next.js 16, next-intl, Tailwind)
packages/db/     Skema Drizzle (MySQL), migrasi, seed
packages/domain/ Aturan bisnis murni (hak akses, uang)
packages/i18n/   Katalog terjemahan id/en/ar
scripts/         setup, doctor, dev (Node, lintas OS)
docs/            Spesifikasi, arsitektur, roadmap, panduan
research/        Hasil riset produk acuan
```

Paket bersama dihubungkan lewat path alias TypeScript, bukan symlink workspace, supaya berjalan juga di
drive exFAT. Penjelasan: `docs/02-arsitektur-dan-database.md`, bagian 1e.

## Dokumen

1. `docs/01-spesifikasi-produk.md` apa yang dibangun
2. `docs/02-arsitektur-dan-database.md` bagaimana membangunnya
3. `docs/03-roadmap.md` urutan fase dan status
4. `docs/04-referensi-visual-dan-struktur-menu.md` struktur menu dan screenshot acuan (hanya internal)
5. `docs/05-menjalankan-tanpa-docker.md` menjalankan dan men-deploy
