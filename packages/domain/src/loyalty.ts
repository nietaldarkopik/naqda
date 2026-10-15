import type { Minor } from "./money";
import { cumulativeShare } from "./stock";
import { mulDivRound } from "./tax";

/**
 * Aturan loyalty. Murni.
 *
 * Poin hanya untuk member. Poin dihitung dari penjualan BERSIH pesanan (nilai barang sebelum pajak dan service, setelah diskon),
 * jadi diskon dan penukaran reward mengurangi poin yang didapat. Pesanan yang direfund mengurangi poin sebanding nilai refund.
 */

export interface SpendRule {
  /** Setiap kelipatan `amount` (satuan terkecil) memberi `points`. */
  amount: Minor;
  points: number;
}

/** Poin dari nilai belanja: lantai(belanja / amount) x points. Kelipatan tidak penuh tidak dihitung. */
export const earnFromSpend = (net: Minor, rule: SpendRule): number => {
  if (!Number.isInteger(net) || net < 0) throw new RangeError("belanja harus integer >= 0");
  if (!Number.isInteger(rule.amount) || rule.amount <= 0) throw new RangeError("amount harus > 0");
  return Math.floor(net / rule.amount) * rule.points;
};

export interface ItemRule {
  itemId: string | null;
  categoryId: string | null;
  pointsPerUnit: number;
}

export interface EarnLine {
  itemId: string | null;
  categoryId: string | null;
  quantity: number;
}

/** Poin dari item: per unit menurut aturan item (didahulukan) atau kategori. Baris tanpa aturan tidak menghasilkan poin. */
export const earnFromItems = (lines: readonly EarnLine[], rules: readonly ItemRule[]): number => {
  let total = 0;
  for (const l of lines) {
    const byItem = l.itemId ? rules.find((r) => r.itemId === l.itemId) : undefined;
    const rule = byItem ?? (l.categoryId ? rules.find((r) => !r.itemId && r.categoryId === l.categoryId) : undefined);
    if (rule) total += rule.pointsPerUnit * l.quantity;
  }
  return total;
};

/** Pengurangan poin untuk refund: sebanding nilai (kumulatif), sehingga refund penuh membatalkan tepat semua poin. */
export const reversalPoints = (earned: number, orderTotal: Minor, refundedBefore: Minor, refundNow: Minor): number => {
  if (earned <= 0 || orderTotal <= 0) return 0;
  const before = Math.min(orderTotal, refundedBefore);
  const after = Math.min(orderTotal, refundedBefore + refundNow);
  return cumulativeShare(earned, orderTotal, after) - cumulativeShare(earned, orderTotal, before);
};

export interface RewardDef {
  kind: "percent_total" | "amount_total" | "item_discount";
  valueKind: "percent" | "amount";
  /** basis point (percent) atau satuan terkecil (amount) */
  value: number;
  maxDiscount: Minor | null;
  minPurchase: Minor;
  itemId: string | null;
  categoryId: string | null;
}

export class RewardError extends Error {
  constructor(
    public readonly code: "min_purchase" | "not_applicable",
    message: string,
  ) {
    super(message);
  }
}

/** Potongan total pesanan dari reward jenis total, dihitung atas nilai setelah diskon baris dan promo. Tidak melebihi nilai itu. */
export const totalRewardDiscount = (reward: RewardDef, afterLines: Minor): Minor => {
  if (afterLines < reward.minPurchase) throw new RewardError("min_purchase", "belanja belum mencapai minimum");
  let amount = reward.valueKind === "percent" ? mulDivRound(afterLines, reward.value, 10_000) : reward.value;
  if (reward.maxDiscount !== null) amount = Math.min(amount, reward.maxDiscount);
  return Math.min(amount, afterLines);
};

export interface RewardLine {
  key: string;
  itemId: string | null;
  categoryId: string | null;
  unitPrice: Minor;
  quantity: number;
  /** Baris yang sudah punya diskon baris tidak ditumpuk. */
  hasDiscount: boolean;
}

export type LineDiscount = { kind: "percent"; bp: number } | { kind: "amount"; amount: Minor };

/**
 * Reward item/kategori: persen berlaku untuk SEMUA baris yang cocok (tanpa diskon baris); nominal berlaku untuk SATU unit
 * pertama yang cocok (potongan tidak melebihi harga unit). Tidak ada baris cocok -> RewardError.
 */
export const itemRewardDiscounts = (reward: RewardDef, lines: readonly RewardLine[]): Map<string, LineDiscount> => {
  const match = lines.filter((l) => !l.hasDiscount && ((reward.itemId && l.itemId === reward.itemId) || (!reward.itemId && reward.categoryId && l.categoryId === reward.categoryId)));
  if (match.length === 0) throw new RewardError("not_applicable", "tidak ada item yang cocok");
  const out = new Map<string, LineDiscount>();
  if (reward.valueKind === "percent") {
    for (const l of match) out.set(l.key, { kind: "percent", bp: reward.value });
  } else {
    const first = match[0]!;
    out.set(first.key, { kind: "amount", amount: Math.min(reward.value, first.unitPrice) });
  }
  return out;
};
