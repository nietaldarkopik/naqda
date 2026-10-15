import type { DiscountInput, OrderLineInput } from "./order";
import { mulDivRound } from "./tax";

/**
 * Pisah bill: memindahkan sebagian jumlah dari baris pesanan ke pesanan baru. Murni.
 * - Diskon persen ikut apa adanya; diskon nominal dibagi sebanding jumlah (sisa pembulatan ke bagian yang tertinggal),
 *   sehingga jumlah kedua sisi tepat sama dengan diskon asal.
 * - Diskon promo TIDAK dibawa: pemanggil menghitung ulang promo untuk kedua pesanan setelah dipisah.
 */

export interface SplitSelection {
  lineId: string;
  quantity: number;
}

export interface SplitResult {
  kept: OrderLineInput[];
  moved: OrderLineInput[];
}

export class SplitError extends Error {
  constructor(
    public readonly code: "unknown_line" | "invalid_quantity" | "nothing_to_move" | "nothing_left",
    message: string,
  ) {
    super(message);
  }
}

const amountOf = (d: DiscountInput | null | undefined): number => (d && d.kind === "amount" ? d.amount : 0);

export const splitLines = (lines: readonly OrderLineInput[], selection: readonly SplitSelection[]): SplitResult => {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const taken = new Map<string, number>();
  for (const s of selection) {
    const line = byId.get(s.lineId);
    if (!line) throw new SplitError("unknown_line", `baris ${s.lineId} tidak ada`);
    if (!Number.isInteger(s.quantity) || s.quantity < 1) throw new SplitError("invalid_quantity", "jumlah pindah harus integer >= 1");
    const total = (taken.get(s.lineId) ?? 0) + s.quantity;
    if (total > line.quantity) throw new SplitError("invalid_quantity", `jumlah pindah melebihi jumlah baris ${s.lineId}`);
    taken.set(s.lineId, total);
  }
  if (taken.size === 0) throw new SplitError("nothing_to_move", "tidak ada yang dipindahkan");

  const kept: OrderLineInput[] = [];
  const moved: OrderLineInput[] = [];
  for (const line of lines) {
    const q = taken.get(line.id) ?? 0;
    if (q === 0) {
      kept.push({ ...line, promoDiscount: undefined });
      continue;
    }
    const movedAmount = amountOf(line.discount) > 0 ? mulDivRound(amountOf(line.discount), q, line.quantity) : 0;
    const keptAmount = amountOf(line.discount) - movedAmount;
    const withDiscount = (amount: number): DiscountInput | null | undefined =>
      line.discount && line.discount.kind === "amount" ? (amount > 0 ? { kind: "amount", amount } : null) : line.discount;

    if (q < line.quantity) kept.push({ id: line.id, unitPrice: line.unitPrice, quantity: line.quantity - q, discount: withDiscount(keptAmount) });
    moved.push({ id: line.id, unitPrice: line.unitPrice, quantity: q, discount: withDiscount(movedAmount) });
  }
  if (kept.length === 0) throw new SplitError("nothing_left", "semua baris dipindahkan; pisah bill harus menyisakan minimal satu baris");
  return { kept, moved };
};
