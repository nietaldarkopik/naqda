# tools

Skrip bantu di luar aplikasi. Keluarannya ditulis ke `build/` (tidak masuk git).

| Skrip | Fungsi | Prasyarat |
|---|---|---|
| `verify_phase1.mjs` | Uji regresi di browser sungguhan (login, katalog, impor CSV, wizard promo, audit, investor, Arab/RTL). Menulis screenshot ke `build/web-shots-p1/` | `npm run dev` berjalan, database demo bersih (`npm run db:reset -- --yes && npm run db:migrate && npm run db:seed`), dan Playwright (`npm i -D playwright && npx playwright install chromium`) |
| `make_pdf.py` | Menyusun dokumen `docs/*.md` menjadi `build/kasirku.html` | Python 3 dengan `markdown` (`pip install markdown`) |
| `pdf.mjs` | Mengubah `build/kasirku.html` menjadi `Naqdi-Dokumen-Pengajuan.pdf` | Playwright (di atas) |

Urutan membuat PDF: `python tools/make_pdf.py && node tools/pdf.mjs`.

Catatan: PDF memuat screenshot produk acuan dari `docs/assets/screens/`. Folder itu **tidak ikut git** (referensi
pihak ketiga, hanya untuk internal). Tanpa folder itu, bagian 4 PDF tidak bergambar.
