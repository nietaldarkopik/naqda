import { formatMoney } from "@naqdi/domain";
import { intlTags, type Locale } from "@naqdi/i18n";

/** Menampilkan uang (integer satuan terkecil) sesuai mata uang bisnis dan bahasa. Digit selalu Latin. */
export const formatMinor = (minor: number, exponent: number, currency: string, locale: Locale): string =>
  formatMoney(minor, exponent, currency, intlTags[locale]);

/**
 * Mengubah teks input (satuan utuh, mis. "12500" atau "12,5") menjadi satuan terkecil tanpa float.
 * Mengembalikan null bila kosong atau tidak valid.
 */
export const parseMajor = (input: string, exponent: number): number | null => {
  const text = input.trim().replace(/\s/g, "");
  if (text === "") return null;
  const pattern = exponent === 0 ? /^\d{1,13}$/ : new RegExp(`^\\d{1,13}([.,]\\d{1,${exponent}})?$`);
  if (!pattern.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(/[.,]/);
  return Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
};

export const toMajorInput = (minor: number, exponent: number): string =>
  exponent === 0 ? String(minor) : (minor / 10 ** exponent).toFixed(exponent);

/** Persen (mis. "11" atau "5,5") menjadi basis point (1100, 550). 0-100%. */
export const parsePercentBp = (input: string): number | null => {
  const text = input.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const bp = Math.round(Number(text) * 100);
  return bp >= 0 && bp <= 10_000 ? bp : null;
};

export const bpToInput = (bp: number): string => String(bp / 100);
