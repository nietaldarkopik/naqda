import type { MonoBitmap } from "./bitmap";

/**
 * Perintah ESC/POS minimal untuk struk. Semua teks dicetak sebagai GAMBAR (raster), bukan teks: dengan begitu huruf Arab
 * (yang tidak ada di tabel kode printer termal), aksara lain, dan logo tampil sama seperti di layar, tanpa tabel karakter.
 * Murni (tanpa DOM atau Bluetooth).
 */

/** Lebar cetak dalam titik: 58 mm = 384 titik, 80 mm = 576 titik (printer 203 dpi). */
export const dotsForPaper = (paperMm: 58 | 80): number => (paperMm === 58 ? 384 : 576);

export const ESC = 0x1b;
export const GS = 0x1d;

/** ESC @ : inisialisasi (membersihkan buffer dan mengembalikan pengaturan bawaan). */
export const init = (): Uint8Array => Uint8Array.of(ESC, 0x40);

/** ESC d n : maju n baris. */
export const feed = (lines: number): Uint8Array => Uint8Array.of(ESC, 0x64, Math.max(0, Math.min(255, Math.floor(lines))));

/** GS V 66 n : maju lalu potong sebagian. Printer tanpa pemotong mengabaikannya. */
export const cut = (feedLines = 3): Uint8Array => Uint8Array.of(GS, 0x56, 66, Math.max(0, Math.min(255, Math.floor(feedLines))));

/** ESC p m t1 t2 : denyut laci kas (pin 2 atau pin 5). Tidak berefek bila laci tidak terpasang. */
export const openDrawer = (pin: 0 | 1 = 0): Uint8Array => Uint8Array.of(ESC, 0x70, pin, 50, 250);

/** ESC a n : rata (0 kiri, 1 tengah, 2 kanan). */
export const align = (mode: 0 | 1 | 2): Uint8Array => Uint8Array.of(ESC, 0x61, mode);

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/**
 * GS v 0 : cetak gambar raster. Dipecah menjadi pita setinggi `bandRows` baris: printer murah punya buffer kecil dan
 * gambar tinggi yang dikirim sekaligus bisa terpotong atau macet. `width` harus kelipatan 8 untuk bitmap yang dibuat
 * dari `rgbaToMono` pada lebar kelipatan 8 (dotsForPaper selalu kelipatan 8).
 */
export const rasterBands = (bmp: MonoBitmap, bandRows = 128): Uint8Array[] => {
  if (bandRows < 1 || bandRows > 255) throw new RangeError("bandRows harus 1-255");
  const bands: Uint8Array[] = [];
  for (let y = 0; y < bmp.height; y += bandRows) {
    const rows = Math.min(bandRows, bmp.height - y);
    const xL = bmp.bytesPerRow & 0xff;
    const xH = (bmp.bytesPerRow >> 8) & 0xff;
    const yL = rows & 0xff;
    const yH = (rows >> 8) & 0xff;
    const header = Uint8Array.of(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH);
    bands.push(concat(header, bmp.bits.subarray(y * bmp.bytesPerRow, (y + rows) * bmp.bytesPerRow)));
  }
  return bands;
};

export interface ReceiptJobOptions {
  /** Maju sekian baris setelah gambar sebelum memotong. */
  feedLines?: number;
  cut?: boolean;
  openDrawer?: boolean;
  bandRows?: number;
}

/** Seluruh pekerjaan cetak satu struk sebagai urutan potongan byte (init, gambar per pita, maju, potong, laci). */
export const receiptJob = (bmp: MonoBitmap, options: ReceiptJobOptions = {}): Uint8Array[] => {
  const parts: Uint8Array[] = [init(), align(0), ...rasterBands(bmp, options.bandRows ?? 128), feed(options.feedLines ?? 4)];
  if (options.cut ?? true) parts.push(cut(0));
  if (options.openDrawer) parts.push(openDrawer());
  return parts;
};

/** Memecah byte menjadi potongan berukuran maksimum `size` untuk tulis Bluetooth bertahap (paket BLE/SPP kecil). */
export const chunk = (bytes: Uint8Array, size: number): Uint8Array[] => {
  if (size < 1) throw new RangeError("ukuran potongan harus >= 1");
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, Math.min(bytes.length, i + size)));
  return out;
};
