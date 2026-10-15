import type { Minor } from "./money";
import { mulDivRound } from "./tax";

/**
 * Hitungan stok. Murni.
 *
 * Jumlah (`Qty`) = integer berskala 1000 (2,5 kg = 2500). Biaya per satuan (`Cost`) = integer berskala 1000 dalam satuan
 * terkecil mata uang (Rp 12,5 per gram = 12500). Nilai (`Minor`) = jumlah x biaya, dalam satuan terkecil biasa.
 * Biaya memakai rata-rata tertimbang (weighted average) per outlet dan objek.
 */

export type Qty = number;
export type Cost = number;

export const SCALE = 1000;
const E6 = SCALE * SCALE;

/** Bilangan desimal (maks. 3 angka di belakang koma) menjadi integer berskala. Melempar RangeError bila lebih presisi. */
export const toScaled = (value: number): number => {
  if (!Number.isFinite(value)) throw new RangeError("angka tidak valid");
  const scaled = Math.round(value * SCALE);
  if (Math.abs(value * SCALE - scaled) > 1e-6) throw new RangeError("maksimal 3 angka di belakang koma");
  return scaled;
};

export const fromScaled = (scaled: number): number => scaled / SCALE;

/** Nilai (satuan terkecil) dari jumlah dan biaya berskala; dibulatkan setengah ke atas menjauhi nol. */
export const valueOf = (qty: Qty, cost: Cost): Minor => {
  if (qty === 0 || cost === 0) return 0;
  const neg = qty < 0 !== cost < 0;
  const v = mulDivRound(Math.abs(qty), Math.abs(cost), E6);
  return neg ? -v : v;
};

export interface Level {
  quantity: Qty;
  avgCost: Cost;
}

/**
 * Penerimaan (pembelian, produksi, transfer masuk, penyesuaian naik): rata-rata tertimbang.
 * Bila saldo sebelumnya nol atau negatif, biaya baru menjadi biaya masuk (stok kosong tidak membawa biaya lama).
 */
export const receive = (level: Level, qty: Qty, cost: Cost): Level => {
  if (qty <= 0) throw new RangeError("jumlah masuk harus positif");
  if (level.quantity <= 0) return { quantity: level.quantity + qty, avgCost: cost };
  const total = level.quantity + qty;
  const weighted = BigInt(level.quantity) * BigInt(level.avgCost) + BigInt(qty) * BigInt(cost);
  const T = BigInt(total);
  return { quantity: total, avgCost: Number((weighted + T / 2n) / T) };
};

/** Pengeluaran (penjualan, transfer keluar, produksi memakai bahan): biaya rata-rata tidak berubah. */
export const issue = (level: Level, qty: Qty): { level: Level; unitCost: Cost; value: Minor } => {
  if (qty <= 0) throw new RangeError("jumlah keluar harus positif");
  return { level: { quantity: level.quantity - qty, avgCost: level.avgCost }, unitCost: level.avgCost, value: -valueOf(qty, level.avgCost) };
};

/** Biaya satu resep: jumlah komponen x biaya masing-masing, dijumlah sebelum dibulatkan. */
export const recipeCost = (lines: readonly { quantity: Qty; cost: Cost }[]): Minor => {
  let sum = 0n;
  for (const l of lines) sum += BigInt(l.quantity) * BigInt(l.cost);
  const half = BigInt(E6) / 2n;
  return Number((sum + half) / BigInt(E6));
};

/**
 * Bagian kumulatif yang dikembalikan ke stok saat sebagian unit baris di-refund. Unit terakhir mendapat sisa,
 * sehingga bila semua unit dikembalikan jumlahnya tepat sama dengan yang pernah dikeluarkan.
 */
export const cumulativeShare = (total: Qty, quantity: number, units: number): Qty =>
  units <= 0 ? 0 : units >= quantity ? total : mulDivRound(total, units, quantity);

export interface Requirement {
  subjectType: "variant" | "ingredient";
  subjectId: string;
  quantity: Qty;
}

/** Menggabungkan kebutuhan stok yang sama (mis. dua baris memakai gula) menjadi satu, urut stabil. */
export const mergeRequirements = (reqs: readonly Requirement[]): Requirement[] => {
  const map = new Map<string, Requirement>();
  for (const r of reqs) {
    const key = `${r.subjectType}:${r.subjectId}`;
    const cur = map.get(key);
    map.set(key, cur ? { ...cur, quantity: cur.quantity + r.quantity } : { ...r });
  }
  return [...map.values()].sort((a, b) => (`${a.subjectType}:${a.subjectId}` < `${b.subjectType}:${b.subjectId}` ? -1 : 1));
};

export interface Shortage {
  subjectType: "variant" | "ingredient";
  subjectId: string;
  needed: Qty;
  available: Qty;
}

/** Kebutuhan yang melebihi saldo yang ada. */
export const findShortages = (reqs: readonly Requirement[], levels: ReadonlyMap<string, Level>): Shortage[] =>
  reqs.flatMap((r) => {
    const available = levels.get(`${r.subjectType}:${r.subjectId}`)?.quantity ?? 0;
    return r.quantity > available ? [{ subjectType: r.subjectType, subjectId: r.subjectId, needed: r.quantity, available }] : [];
  });
