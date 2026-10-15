import type { Minor } from "./money";
import { mulDivRound } from "./tax";

/**
 * Bantuan laporan. Murni.
 *
 * Definisi angka (doc 02, bagian 8):
 *  - Gross Sales   = subtotal pesanan (harga menu x jumlah, sebelum diskon).
 *  - Discounts     = diskon baris + promo + diskon pesanan.
 *  - Net Sales     = nilai barang sebelum pajak dan service, sesudah diskon (`net` pesanan), dikurangi bagian nilai barang dari refund.
 *    Pada outlet yang harga menunya SUDAH termasuk pajak/service, Gross - Discounts masih memuat pajak/service itu; selisihnya
 *    ditampilkan sebagai "Included tax/service" agar tabel tetap menjumlah.
 *  - Total Collected = total pesanan dikurangi total refund.
 * Semua laporan memakai zona waktu outlet.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isLocalDate = (value: string): boolean => {
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const fmt = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
};

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalMoment {
  /** "YYYY-MM-DD" menurut zona waktu. */
  date: string;
  hour: number;
  /** 0 = Minggu ... 6 = Sabtu */
  weekday: number;
}

export const localMoment = (at: Date, timeZone: string): LocalMoment => {
  const parts = fmt(timeZone).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday: WEEKDAY[get("weekday")] ?? 0 };
};

/** Selisih (ms) waktu setempat terhadap UTC pada saat `at`. */
const offsetMs = (at: Date, timeZone: string): number => {
  const parts = fmt(timeZone).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
};

/** Awal hari ("YYYY-MM-DD" setempat) sebagai saat UTC. Dua iterasi menangani perpindahan DST. */
export const localDayStartUtc = (date: string, timeZone: string): Date => {
  const m = DAY.exec(date);
  if (!m) throw new RangeError(`tanggal tidak valid: ${date}`);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let guess = new Date(wall - offsetMs(new Date(wall), timeZone));
  guess = new Date(wall - offsetMs(guess, timeZone));
  return guess;
};

export const addDays = (date: string, days: number): string => {
  const m = DAY.exec(date);
  if (!m) throw new RangeError(`tanggal tidak valid: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
};

/** Rentang [mulai, akhir) UTC untuk tanggal setempat `from`..`to` (keduanya inklusif). */
export const localRangeUtc = (from: string, to: string, timeZone: string): { start: Date; end: Date } => ({
  start: localDayStartUtc(from, timeZone),
  end: localDayStartUtc(addDays(to, 1), timeZone),
});

export const daysBetween = (from: string, to: string): number => {
  const a = DAY.exec(from);
  const b = DAY.exec(to);
  if (!a || !b) throw new RangeError("tanggal tidak valid");
  return Math.round((Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))) / 86_400_000) + 1;
};

/**
 * Rincian sebuah refund R dari pesanan: bagian service dan pajak sebanding totalnya, sisanya nilai barang
 * (menyerap pembulatan). Jumlah ketiganya selalu tepat R.
 */
export const splitRefund = (refund: Minor, order: { total: Minor; gratuity: Minor; tax: Minor }): { net: Minor; gratuity: Minor; tax: Minor } => {
  if (order.total <= 0 || refund <= 0) return { net: refund, gratuity: 0, tax: 0 };
  const gratuity = Math.min(refund, mulDivRound(refund, order.gratuity, order.total));
  const tax = Math.min(refund - gratuity, mulDivRound(refund, order.tax, order.total));
  return { net: refund - gratuity - tax, gratuity, tax };
};
