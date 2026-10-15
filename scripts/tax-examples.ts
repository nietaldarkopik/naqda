// Membuat docs/06-contoh-perhitungan.md dari MESIN HITUNG SUNGGUHAN (packages/domain), bukan dari tulisan tangan, sehingga
// dokumen untuk akuntan tidak bisa menyimpang dari perilaku aplikasi. Jalankan: npm run docs:tax-examples
import { writeFileSync } from "node:fs";
import { computeOrder, formatMoney, type DiscountMode, type OrderInput, type OrderSettings } from "@naqdi/domain";

interface Scenario {
  title: string;
  why: string;
  currency: string;
  exponent: number;
  tag: string;
  lines: { name: string; unit: number; qty: number; discount?: OrderInput["lines"][number]["discount"] }[];
  orderDiscount?: OrderInput["orderDiscount"];
  taxes: { name: string; bp: number }[];
  gratuities: { name: string; bp: number }[];
  settings: Partial<OrderSettings>;
}

const base: OrderSettings = { pricesIncludeTax: false, pricesIncludeGratuity: false, taxOnGratuity: true, roundingStep: 0, roundingMode: "nearest", discountMode: "sequential" };

const scenarios: Scenario[] = [
  {
    title: "A. Rupiah, restoran: PB1 10% + service 5% (harga di luar pajak), pembulatan Rp 100",
    why: "Pola umum restoran Indonesia. Pajak juga dikenakan atas service charge.",
    currency: "IDR", exponent: 0, tag: "id-ID",
    lines: [{ name: "Nasi Goreng", unit: 28000, qty: 2 }, { name: "Es Teh", unit: 8000, qty: 2 }],
    taxes: [{ name: "PB1", bp: 1000 }], gratuities: [{ name: "Service", bp: 500 }],
    settings: { roundingStep: 100 },
  },
  {
    title: "B. Rupiah, PPN 11% sudah termasuk di harga menu",
    why: "Harga yang dilihat pelanggan sudah mengandung pajak; pajak DIPISAHKAN dari harga, total tidak bertambah.",
    currency: "IDR", exponent: 0, tag: "id-ID",
    lines: [{ name: "Kopi", unit: 22000, qty: 3 }],
    taxes: [{ name: "PPN", bp: 1100 }], gratuities: [],
    settings: { pricesIncludeTax: true },
  },
  {
    title: "C. Diskon: baris 20% + diskon pesanan 10%, tiga cara menggabung",
    why: "Cara gabung diskon diatur per outlet. Pajak dihitung dari harga SETELAH semua diskon.",
    currency: "IDR", exponent: 0, tag: "id-ID",
    lines: [{ name: "Kopi", unit: 20000, qty: 2, discount: { kind: "percent", bp: 2000 } }, { name: "Teh", unit: 10000, qty: 1 }],
    orderDiscount: { kind: "percent", bp: 1000 },
    taxes: [{ name: "PPN", bp: 1100 }], gratuities: [],
    settings: {},
  },
  {
    title: "D. Dolar AS: sales tax 8,25% di luar harga, pembulatan tunai ke 5 sen",
    why: "Toko luar negeri dengan dua desimal. Pembulatan 5 sen dicatat terpisah dari pajak.",
    currency: "USD", exponent: 2, tag: "en-US",
    lines: [{ name: "Latte", unit: 1237, qty: 2 }, { name: "Muffin", unit: 345, qty: 1 }],
    taxes: [{ name: "Sales tax", bp: 825 }], gratuities: [],
    settings: { roundingStep: 5 },
  },
  {
    title: "E. Riyal Saudi: VAT 15% di luar harga",
    why: "Dua desimal (halala). Setengah ke atas pada pajak.",
    currency: "SAR", exponent: 2, tag: "en-US",
    lines: [{ name: "Karak", unit: 1250, qty: 3 }],
    taxes: [{ name: "VAT", bp: 1500 }], gratuities: [],
    settings: {},
  },
  {
    title: "F. Riyal Saudi: VAT 15% sudah termasuk di harga",
    why: "Harga rak sudah termasuk VAT, umum di Arab Saudi.",
    currency: "SAR", exponent: 2, tag: "en-US",
    lines: [{ name: "Karak", unit: 1250, qty: 3 }],
    taxes: [{ name: "VAT", bp: 1500 }], gratuities: [],
    settings: { pricesIncludeTax: true },
  },
  {
    title: "G. Dua pajak sekaligus (5% dan 6%) dengan dolar Singapura",
    why: "Beberapa pajak berlaku bersamaan; sisa pembulatan masuk ke pajak terakhir agar jumlah per pajak cocok dengan total.",
    currency: "SGD", exponent: 2, tag: "en-US",
    lines: [{ name: "Set A", unit: 1999, qty: 3 }],
    taxes: [{ name: "Pajak 1", bp: 500 }, { name: "Pajak 2", bp: 600 }], gratuities: [],
    settings: {},
  },
  {
    title: "H. Arah pembulatan Rp 1.000: terdekat, ke atas, ke bawah",
    why: "Aturan pembulatan berbeda per toko. Selisih dicatat di baris Pembulatan.",
    currency: "IDR", exponent: 0, tag: "id-ID",
    lines: [{ name: "Roti", unit: 15400, qty: 1 }],
    taxes: [{ name: "PPN", bp: 1100 }], gratuities: [],
    settings: { roundingStep: 1000 },
  },
];

const out: string[] = [];
const push = (s = "") => out.push(s);
const m = (sc: Scenario, v: number) => formatMoney(v, sc.exponent, sc.currency, sc.tag).replace(/ /g, " ");

const calc = (sc: Scenario, settings: Partial<OrderSettings>) => {
  const s = { ...base, ...sc.settings, ...settings };
  return {
    s,
    r: computeOrder({
      lines: sc.lines.map((l, i) => ({ id: String(i), unitPrice: l.unit, quantity: l.qty, discount: l.discount ?? null })),
      orderDiscount: sc.orderDiscount ?? null,
      taxRatesBp: sc.taxes.map((t) => t.bp),
      gratuityRatesBp: sc.gratuities.map((g) => g.bp),
      settings: s,
    }),
  };
};

const rows = (sc: Scenario, label: string, settings: Partial<OrderSettings>) => {
  const { r } = calc(sc, settings);
  push(`**${label}**`);
  push();
  push("| Langkah | Jumlah |");
  push("|---|---:|");
  push(`| Subtotal (harga x jumlah) | ${m(sc, r.subtotal)} |`);
  if (r.discountTotal > 0) push(`| Diskon (baris + pesanan) | −${m(sc, r.discountTotal)} |`);
  push(`| Harga setelah diskon (B) | ${m(sc, r.base)} |`);
  push(`| Nilai barang sebelum pajak dan service (N) | ${m(sc, r.net)} |`);
  sc.gratuities.forEach((g, i) => push(`| ${g.name} ${g.bp / 100}% | ${m(sc, r.gratuityPerRate[i] ?? 0)} |`));
  sc.taxes.forEach((t, i) => push(`| ${t.name} ${t.bp / 100}% | ${m(sc, r.taxPerRate[i] ?? 0)} |`));
  if (r.rounding !== 0) push(`| Pembulatan | ${r.rounding > 0 ? "+" : "−"}${m(sc, Math.abs(r.rounding))} |`);
  push(`| **Total yang dibayar pelanggan** | **${m(sc, r.total)}** |`);
  push();
};

push("# 06. Contoh perhitungan untuk diverifikasi akuntan");
push();
push("> **Dokumen ini DIHASILKAN OTOMATIS** oleh `npm run docs:tax-examples` dari mesin hitung yang sama dengan yang dipakai kasir dan server");
push("> (`packages/domain`). Jangan diedit tangan; ubah skenario di `scripts/tax-examples.ts`. Tujuannya: akuntan atau konsultan pajak dapat");
push("> memeriksa **angkanya** tanpa membaca kode. **Belum ada verifikasi profesional**; dokumen ini adalah bahan untuk itu.");
push();
push("## Aturan yang diterapkan");
push();
push("1. Harga baris = harga satuan (sudah termasuk modifier) x jumlah.");
push("2. Diskon baris (persen atau nominal), lalu promo otomatis, lalu diskon pesanan. Hasilnya **B** (harga setelah diskon). Cara menggabung tiga diskon ini diatur per outlet:");
push("   *berurutan* (tiap diskon dari sisa), *kombinasi* (persen dihitung dari harga awal lalu dijumlahkan, maksimal sampai nol), atau *salah satu* (satu baris hanya menerima diskon terbesar).");
push("3. Dari B diturunkan **N** (nilai barang sebelum pajak dan service). Service charge **G** = tarif x N. Pajak barang = tarif x N. Pajak atas service = tarif x G (bila \"pajak atas service\" aktif).");
push("4. Bila harga menu **sudah termasuk** pajak (atau service), komponen itu dipisahkan dari B dan total tidak bertambah; bila **belum**, ditambahkan di atas B.");
push("5. Pembulatan akhir ke kelipatan yang diatur outlet (terdekat/atas/bawah), dicatat terpisah sebagai **Pembulatan**; setengah dibulatkan ke atas.");
push("6. Semua angka bilangan bulat dalam satuan terkecil (rupiah: rupiah; dolar dan riyal: sen dan halala). Persen dalam basis point (10% = 1000), dihitung dengan bilangan bulat tanpa pecahan desimal; sisa pembulatan antar-pajak masuk ke pajak terakhir.");
push();
push("## Pertanyaan untuk akuntan");
push();
push("- Apakah dasar pengenaan pajak (**N**) sesuai: setelah diskon, sebelum service? Apakah pajak boleh dikenakan atas service charge di yurisdiksi Anda?");
push("- Apakah pembulatan boleh dimasukkan sebagai baris terpisah dan di mana dicatat pada pembukuan (pendapatan lain-lain)?");
push("- Untuk harga **termasuk pajak**: apakah pemisahan pajak (harga x tarif / (100% + tarif)) dan pembulatannya sesuai?");
push("- Apakah diskon pesanan mengurangi dasar pajak seluruhnya (sebagaimana di sini) atau ada aturan khusus?");
push("- Apakah struk memuat semua unsur wajib (nomor pajak, nomor struk berurutan, rincian pajak, tanggal)?");
push("- Untuk **refund**: pajak dan service dikembalikan sebanding bagian yang di-refund (lihat `docs/03-roadmap.md`); apakah ini sesuai?");
push();
push("## Skenario");
push();

for (const sc of scenarios) {
  push(`### ${sc.title}`);
  push();
  push(sc.why);
  push();
  push("Isi pesanan:");
  push();
  push("| Barang | Harga satuan | Jumlah | Diskon baris |");
  push("|---|---:|---:|---|");
  for (const l of sc.lines) push(`| ${l.name} | ${m(sc, l.unit)} | ${l.qty} | ${l.discount ? (l.discount.kind === "percent" ? `${l.discount.bp / 100}%` : m(sc, l.discount.amount)) : "-"} |`);
  push();
  const extra = [
    sc.orderDiscount ? `diskon pesanan ${sc.orderDiscount.kind === "percent" ? `${sc.orderDiscount.bp / 100}%` : m(sc, sc.orderDiscount.amount)}` : "",
    sc.settings.pricesIncludeTax ? "harga **sudah termasuk** pajak" : "harga **di luar** pajak",
    sc.settings.roundingStep ? `pembulatan ke kelipatan ${m(sc, sc.settings.roundingStep)} (${sc.settings.roundingMode ?? "terdekat"})` : "tanpa pembulatan",
  ].filter(Boolean);
  push(`Pengaturan: ${extra.join("; ")}.`);
  push();

  if (sc.title.startsWith("C.")) {
    for (const mode of ["sequential", "stack", "exclusive"] as DiscountMode[]) rows(sc, `Cara gabung diskon: ${{ sequential: "berurutan", stack: "kombinasi", exclusive: "salah satu" }[mode]}`, { discountMode: mode });
  } else if (sc.title.startsWith("H.")) {
    for (const mode of ["nearest", "up", "down"] as const) rows(sc, `Pembulatan: ${{ nearest: "terdekat", up: "ke atas", down: "ke bawah" }[mode]}`, { roundingMode: mode });
  } else rows(sc, "Hasil", {});
}

push("---");
push();
push("Dihasilkan dengan `computeOrder` (packages/domain/src/order.ts). Tes otomatisnya ada di `packages/domain/test/` dan `apps/api/test/` (termasuk");
push("paritas antara kasir offline dan server).");

writeFileSync(new URL("../docs/06-contoh-perhitungan.md", import.meta.url), out.join("\n") + "\n");
console.log(`docs/06-contoh-perhitungan.md dibuat (${scenarios.length} skenario)`);
