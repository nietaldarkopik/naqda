import markdown, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
(root / "build").mkdir(exist_ok=True)
files = [("1","Spesifikasi Produk","docs/01-spesifikasi-produk.md"),
         ("2","Arsitektur dan Database","docs/02-arsitektur-dan-database.md"),
         ("3","Roadmap Pembangunan","docs/03-roadmap.md"),
         ("4","Referensi Visual dan Struktur Menu","docs/04-referensi-visual-dan-struktur-menu.md")]
md = markdown.Markdown(extensions=["tables","fenced_code"])
body = ""
for n,t,f in files:
    txt = (root/f).read_text(encoding="utf-8")
    txt = re.sub(r"^# \d+\. ", "# ", txt, count=1, flags=re.M)
    md.reset()
    html = md.convert(txt).replace('src="assets/', 'src="../docs/assets/')
    body += f'<section class="doc"><div class="partno">Bagian {n}</div>{html}</section>'
toc = "".join(f"<li><span>Bagian {n}</span> {t}</li>" for n,t,_ in files)
css = """
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color:#1b2330; }
h1 { font-size: 22pt; color:#12355b; margin: 0 0 8pt; border-bottom: 2px solid #12355b; padding-bottom: 6pt; }
h2 { font-size: 15pt; color:#12355b; margin-top: 18pt; break-after: avoid; }
h3 { font-size: 12pt; color:#244a77; margin-top: 12pt; break-after: avoid; }
.doc { break-before: page; }
.partno { text-transform: uppercase; letter-spacing: 2px; font-size: 9pt; color:#6b7a90; margin-bottom: 2pt; }
table { border-collapse: collapse; width:100%; margin: 8pt 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #c9d2de; padding: 4pt 6pt; vertical-align: top; text-align:left; }
th { background:#eaf0f7; }
code { font-family: Consolas, monospace; font-size: 9pt; background:#f1f4f8; padding: 0 2pt; border-radius: 2px; }
pre { background:#f1f4f8; border:1px solid #d9e0ea; padding: 7pt; font-size: 8.3pt; line-height:1.35; white-space: pre-wrap; border-radius:4px; }
pre code { background:none; padding:0; }
blockquote { border-left: 3px solid #e0a100; background:#fff8e1; margin: 8pt 0; padding: 4pt 10pt; color:#4a3b00; }
li { margin: 2pt 0; }
.cover { height: 250mm; display:flex; flex-direction:column; justify-content:center; }
.cover h1 { font-size: 32pt; border:none; margin-bottom: 4pt; }
.cover .sub { font-size: 14pt; color:#4a5a70; margin-bottom: 28pt; }
.cover .meta { font-size: 10.5pt; color:#4a5a70; margin-bottom: 26pt; }
.cover ol { padding-left: 0; list-style:none; font-size: 12pt; }
.cover ol li span { display:inline-block; width: 70pt; color:#6b7a90; }
.box { border:1px solid #c9d2de; border-radius:6px; padding: 10pt 14pt; background:#f7f9fc; }
.box h3 { margin-top:0; }
.summary { break-before: page; }
.gallery { display:block; }
.gallery figure { margin: 0 0 9pt; break-inside: avoid; }
.gallery img { width: 100%; border: 1px solid #c9d2de; border-radius: 3px; display:block; }
.gallery figcaption { font-size: 8.8pt; color:#4a5a70; margin-top: 2pt; }
.gallery.two { display:grid; grid-template-columns: 1fr 1fr; gap: 8pt 10pt; }
.gallery.two figure { margin:0; }
"""
cover = f"""
<div class="cover">
  <div class="partno">Dokumen pengajuan proyek</div>
  <h1>Naqdi</h1>
  <div class="sub">Aplikasi kasir (POS) berbasis cloud untuk F&amp;B dan retail<br>Spesifikasi, arsitektur, dan rencana pembangunan</div>
  <div class="meta">Tanggal: 13 Oktober 2026 &nbsp;|&nbsp; Status: draf untuk persetujuan tim<br>
  Dasar: analisis 16 video tutorial Back Office dan aplikasi kasir. Screenshot hanya referensi riset internal</div>
  <div class="box"><h3>Isi dokumen</h3><ol>{toc}</ol></div>
</div>
<section class="summary">
<h1>Ringkasan untuk keputusan</h1>
<p><b>Apa yang diajukan.</b> Membangun aplikasi kasir multi-outlet dengan dua permukaan: <b>Back Office</b> (browser desktop)
dan <b>Kasir</b> (PWA tablet). Fitur mengacu pada produk sejenis yang ada di pasar. Ini clone fungsional;
nama, logo, gambar, dan teks asli tidak dipakai.</p>
<p><b>Cakupan versi 1.</b> Katalog dan harga per sales type, transaksi dine-in dengan meja, pisah bill, refund, shift,
stok item dan ingredient (PO, transfer, adjustment), laporan dan dashboard, loyalty pelanggan, role dan hak akses,
serta pengaturan checkout dan struk, dalam tiga bahasa (Indonesia, Inggris, Arab). Bagian 4 memuat struktur menu dan 45 screenshot referensi; bagian 2 memuat matriks perangkat keras (printer dan lainnya). Pembayaran digital, SMS/email, printer, dan integrasi GoFood/Moka Order
dibuat sebagai stub.</p>
<p><b>Platform.</b> Web, desktop, dan mobile. Versi 1 dirilis sebagai web (Back Office + kasir PWA); kasir desktop (Tauri) dan mobile (Capacitor) menyusul dari basis kode yang sama, dengan API token, paket domain bersama, dan adapter perangkat keras.</p>
<p><b>Rencana.</b> Fase 0–8 untuk web (estimasi kasar 25–34 sesi kerja), fase 10 desktop (2–3 sesi) dan fase 11 mobile (3–4 sesi); fase 9 integrasi eksternal opsional. Dukungan tiga bahasa dan RTL menambah sekitar 3–5 sesi bila dikerjakan sejak fase 0 (jauh lebih mahal bila ditambah belakangan). Angka perlu dikalibrasi ulang setelah fase 0.</p>
<table>
<tr><th>Keputusan yang diminta</th><th>Usulan</th></tr>
<tr><td>Stack teknologi</td><td>Diputuskan: full TypeScript. API Node mandiri (Hono/Fastify), Next.js untuk tampilan, MySQL 8.4; tanpa PHP/Laravel. Harus bisa dijalankan dengan maupun tanpa Docker (Redis opsional)</td></tr>
<tr><td>Platform</td><td>Web dulu, lalu desktop (Tauri) dan mobile (Capacitor) dengan satu basis kode</td></tr>
<tr><td>Bahasa antarmuka</td><td>Diputuskan: Indonesia (default), Inggris, Arab dengan tata letak kanan-ke-kiri (RTL); disiapkan sejak fase 0</td></tr>
<tr><td>Tujuan penggunaan</td><td>Perlu ditentukan: pembelajaran/demo atau bisnis nyata (menentukan kedalaman keamanan dan integrasi pembayaran)</td></tr>
<tr><td>Nama dan identitas visual</td><td>Nama produk: Naqdi. Logo dan warna belum ditentukan</td></tr>
<tr><td>Mulai pengerjaan</td><td>Fase 0 (fondasi) setelah persetujuan</td></tr>
</table>
<h3>Risiko utama</h3>
<ul>
<li>Rumus total pesanan (urutan diskon, gratuity, pajak, pembulatan) <b>belum terkonfirmasi</b> dari sumber; harus diverifikasi sebelum dikunci.</li>
<li>Riset dibaca dari frame video per 30 detik, sehingga dialog singkat bisa terlewat.</li>
<li>Dukungan desktop/mobile hanya murah bila aturan arsitektur (API token, paket domain bebas React) dipatuhi sejak fase 0; printer Bluetooth/USB perlu diuji di perangkat nyata.</li>
<li>Bahasa Arab (RTL) harus dirancang sejak awal; struk Arab di printer thermal perlu dirender sebagai gambar dan diuji di perangkat nyata.</li>
<li>Cakupan luas; mitigasi dengan fase bertahap dan stub integrasi eksternal.</li>
</ul>
</section>
"""
html = f"<!doctype html><html lang='id'><head><meta charset='utf-8'><title>Naqdi - Dokumen Pengajuan</title><style>{css}</style></head><body>{cover}{body}</body></html>"
pathlib.Path(root/"build/kasirku.html").write_text(html, encoding="utf-8")
