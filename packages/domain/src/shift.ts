import type { Minor } from "./money";

/** Rekonsiliasi kas shift. Murni. */

export interface ShiftCashInput {
  openingCash: Minor;
  /** Tunai bersih dari penjualan (tunai diterima dikurangi kembalian). */
  cashSales: Minor;
  /** Refund yang dikembalikan tunai. */
  cashRefunds: Minor;
  /** Kas masuk manual (mis. tambah modal laci). */
  cashIn: Minor;
  /** Kas keluar manual (mis. beli es batu, setor). */
  cashOut: Minor;
}

export const expectedCash = (i: ShiftCashInput): Minor => {
  for (const [k, v] of Object.entries(i)) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`${k} harus integer >= 0`);
  }
  return i.openingCash + i.cashSales - i.cashRefunds + i.cashIn - i.cashOut;
};

/** Selisih = uang hitung aktual - uang yang diharapkan. Negatif = kurang, positif = lebih. */
export const cashDifference = (actual: Minor, expected: Minor): Minor => {
  if (!Number.isInteger(actual) || actual < 0) throw new RangeError("uang aktual harus integer >= 0");
  return actual - expected;
};
