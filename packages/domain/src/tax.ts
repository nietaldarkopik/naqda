import type { Minor } from "./money";

/**
 * Perhitungan pajak untuk dua mode toko:
 * - eksklusif (`pricesIncludeTax = false`): pajak DITAMBAHKAN di atas harga.
 * - inklusif  (`pricesIncludeTax = true`): harga sudah termasuk pajak; pajak DIPISAHKAN dari harga.
 *
 * Semua dalam integer satuan terkecil. Tarif dalam basis point (10% = 1000).
 * Pembulatan: setengah ke atas, dan pajak selalu dihitung sehingga net + pajak = bruto tepat (tanpa selisih sen).
 */

/** (a * b) / c dibulatkan setengah ke atas, tanpa kehilangan presisi walau a*b melebihi 2^53. */
export const mulDivRound = (a: number, b: number, c: number): number => {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c) || c <= 0) {
    throw new RangeError("mulDivRound butuh integer dan pembagi positif");
  }
  const A = BigInt(a);
  const B = BigInt(b);
  const C = BigInt(c);
  const negative = A * B < 0n;
  const product = negative ? -(A * B) : A * B;
  const q = (product + C / 2n) / C;
  return Number(negative ? -q : q);
};

export interface TaxResult {
  /** Harga sebelum pajak. */
  net: Minor;
  /** Total pajak. */
  tax: Minor;
  /** Harga yang dibayar pelanggan untuk bagian ini (net + tax). */
  gross: Minor;
  /** Pajak per tarif, urutan sama dengan input; jumlahnya selalu sama dengan `tax`. */
  perTax: Minor[];
}

const assertRates = (ratesBp: readonly number[]) => {
  for (const r of ratesBp) {
    if (!Number.isInteger(r) || r < 0 || r > 10_000) throw new RangeError("tarif harus 0-10000 basis point");
  }
};

/** Membagi `total` ke tarif secara proporsional; sisa pembulatan diberikan ke tarif terakhir agar jumlahnya tepat. */
const allocate = (total: Minor, ratesBp: readonly number[]): Minor[] => {
  const sum = ratesBp.reduce((a, b) => a + b, 0);
  if (ratesBp.length === 0) return [];
  if (sum === 0) return ratesBp.map(() => 0);
  const parts = ratesBp.map((r) => mulDivRound(total, r, sum));
  const drift = total - parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] = (parts[parts.length - 1] ?? 0) + drift;
  return parts;
};

/**
 * Menghitung pajak dari `amount`.
 * - eksklusif: `amount` = net; pajak ditambahkan.
 * - inklusif:  `amount` = bruto; pajak dipisahkan.
 * Beberapa pajak diperlakukan sebagai tarif gabungan (bukan berlapis).
 */
export const applyTaxes = (amount: Minor, ratesBp: readonly number[], pricesIncludeTax: boolean): TaxResult => {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("jumlah harus integer >= 0");
  assertRates(ratesBp);
  const combined = ratesBp.reduce((a, b) => a + b, 0);

  let net: Minor;
  let tax: Minor;
  if (pricesIncludeTax) {
    net = mulDivRound(amount, 10_000, 10_000 + combined);
    tax = amount - net;
  } else {
    net = amount;
    tax = mulDivRound(amount, combined, 10_000);
  }
  return { net, tax, gross: net + tax, perTax: allocate(tax, ratesBp) };
};
