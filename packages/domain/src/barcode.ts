/**
 * Barcode produk. Satu varian punya paling banyak satu barcode, unik per bisnis.
 * Kode boleh barcode pabrik (EAN-13) atau kode buatan sendiri.
 */

/** Digit pemeriksa EAN-13 untuk 12 digit pertama. */
export const ean13CheckDigit = (first12: string): number => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
};

/** 13 digit dengan digit pemeriksa yang benar. */
export const isValidEan13 = (code: string): boolean => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);

export type BarcodeProblem = "empty" | "length" | "charset" | "ean13_checksum";

/**
 * Memeriksa kode yang diketik di Back Office. Karakter: ASCII tercetak tanpa spasi (yang dikirim scanner), maks. 64.
 * Kode berupa tepat 13 digit dianggap EAN-13 dan HARUS lolos digit pemeriksa (menangkap salah ketik); karena itu kode buatan
 * sendiri sebaiknya tidak berupa tepat 13 digit.
 */
export const barcodeProblem = (code: string): BarcodeProblem | null => {
  if (code.length === 0) return "empty";
  if (code.length > 64) return "length";
  if (!/^[\x21-\x7E]+$/.test(code)) return "charset";
  if (/^\d{13}$/.test(code) && !isValidEan13(code)) return "ean13_checksum";
  return null;
};

// ---------------------------------------------------------------------------------------------
// Deteksi scanner mode keyboard: scanner "mengetik" kode dengan jeda antar-tombol sangat pendek lalu menekan Enter,
// sedangkan manusia jauh lebih lambat.

export interface ScanOptions {
  /** Jeda maksimum antar-tombol (ms) agar masih dianggap scanner. */
  maxGapMs?: number;
  /** Panjang kode minimum. */
  minLength?: number;
}

/**
 * Mengumpulkan tombol yang datang berurutan cepat. `key()` mengembalikan kode ketika Enter datang setelah deretan cepat
 * sepanjang minimal `minLength`; selain itu null. Murni: waktu diberikan oleh pemanggil.
 */
export class ScanDetector {
  private buffer = "";
  private last = 0;
  private readonly maxGap: number;
  private readonly minLength: number;

  constructor(options: ScanOptions = {}) {
    this.maxGap = options.maxGapMs ?? 40;
    this.minLength = options.minLength ?? 3;
  }

  reset(): void {
    this.buffer = "";
    this.last = 0;
  }

  /** Jumlah karakter yang sedang terkumpul sebagai kandidat scan. */
  get pending(): number {
    return this.buffer.length;
  }

  key(key: string, at: number): string | null {
    if (key === "Enter") {
      const code = this.buffer;
      this.reset();
      return code.length >= this.minLength ? code : null;
    }
    if (key.length !== 1) return null; // Shift, Tab, dll. tidak memutus deretan
    if (this.buffer && at - this.last > this.maxGap) this.buffer = "";
    this.buffer += key;
    this.last = at;
    return null;
  }
}
