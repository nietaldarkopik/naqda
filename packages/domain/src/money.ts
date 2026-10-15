/**
 * Uang selalu integer dalam satuan terkecil mata uang (doc 02, bagian 3).
 * Rupiah: exponent 0. SAR/AED: exponent 2.
 */

export type Minor = number;

export const toMinor = (amount: number, exponent: number): Minor => Math.round(amount * 10 ** exponent);

export const fromMinor = (minor: Minor, exponent: number): number => minor / 10 ** exponent;

/**
 * Pembulatan ke kelipatan `step` (satuan terkecil). Titik tengah dibulatkan ke atas.
 * Contoh rupiah: roundTo(10449, 100) = 10400, roundTo(10450, 100) = 10500.
 */
export const roundTo = (minor: Minor, step: number): Minor => {
  if (!Number.isInteger(minor)) throw new RangeError("nilai uang harus integer");
  if (!Number.isInteger(step) || step <= 0) throw new RangeError("step harus integer positif");
  return Math.floor((minor + step / 2) / step) * step;
};

/**
 * Menampilkan uang. Rupiah SELALU tampil gaya Indonesia ("Rp 18.000") apa pun bahasa antarmukanya, karena bisnis rupiah
 * tidak mengharapkan "IDR 18,000"; mata uang lain mengikuti bahasa antarmuka (mis. "$12.37", "SAR 12.50", "12.50 ر.س.").
 */
export const formatMoney = (minor: Minor, exponent: number, currency: string, intlTag: string): string =>
  new Intl.NumberFormat(currency === "IDR" ? "id-ID" : intlTag, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(fromMinor(minor, exponent));
