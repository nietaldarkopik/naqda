/**
 * Mata uang yang didukung. Jumlah desimal (exponent) mengikuti ISO 4217 dan DITURUNKAN dari kode, bukan dipilih bebas:
 * salah exponent membuat semua angka tersimpan bergeser (Rp 18.000 menjadi 180,00). Semua uang disimpan sebagai bilangan
 * bulat satuan terkecil (rupiah: rupiah; dolar dan riyal: sen dan halala; dinar Kuwait: fils).
 */
export interface CurrencyInfo {
  code: string;
  exponent: 0 | 2 | 3;
}

export const supportedCurrencies: readonly CurrencyInfo[] = [
  { code: "IDR", exponent: 0 },
  // Dolar
  { code: "USD", exponent: 2 },
  { code: "SGD", exponent: 2 },
  { code: "AUD", exponent: 2 },
  { code: "CAD", exponent: 2 },
  { code: "NZD", exponent: 2 },
  { code: "HKD", exponent: 2 },
  { code: "BND", exponent: 2 },
  // Riyal dan Timur Tengah
  { code: "SAR", exponent: 2 },
  { code: "AED", exponent: 2 },
  { code: "QAR", exponent: 2 },
  { code: "OMR", exponent: 3 },
  { code: "KWD", exponent: 3 },
  { code: "BHD", exponent: 3 },
  { code: "JOD", exponent: 3 },
  { code: "EGP", exponent: 2 },
  // Lainnya
  { code: "EUR", exponent: 2 },
  { code: "GBP", exponent: 2 },
  { code: "CHF", exponent: 2 },
  { code: "MYR", exponent: 2 },
  { code: "THB", exponent: 2 },
  { code: "PHP", exponent: 2 },
  { code: "VND", exponent: 0 },
  { code: "INR", exponent: 2 },
  { code: "CNY", exponent: 2 },
  { code: "JPY", exponent: 0 },
  { code: "KRW", exponent: 0 },
  { code: "TRY", exponent: 2 },
];

const byCode = new Map(supportedCurrencies.map((c) => [c.code, c]));

export const currencyInfo = (code: string): CurrencyInfo | undefined => byCode.get(code.toUpperCase());

export const isSupportedCurrency = (code: string): boolean => byCode.has(code.toUpperCase());

/** Exponent resmi untuk kode mata uang; melempar bila tidak didukung. */
export const exponentOf = (code: string): number => {
  const info = currencyInfo(code);
  if (!info) throw new RangeError(`mata uang tidak didukung: ${code}`);
  return info.exponent;
};
