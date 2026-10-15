import type { Minor } from "./money";
import { allocateProportional } from "./order";
import { mulDivRound } from "./tax";

/**
 * Refund sebagian atau penuh. Murni.
 *
 * Total yang dibayar pelanggan (termasuk service, pajak, dan pembulatan) dibagi ke baris sebanding "bobot" baris
 * (harga setelah semua diskon, termasuk bagian diskon pesanan). Refund per jumlah memakai pembagian kumulatif:
 * unit terakhir dari sebuah baris selalu mendapat sisa, sehingga bila semua unit di-refund, jumlah refund tepat
 * sama dengan total yang dibayar (tidak ada selisih satu satuan terkecil pun).
 */

export interface RefundLineInput {
  id: string;
  /** Harga baris setelah semua diskon (>= 0). */
  weight: Minor;
  quantity: number;
  /** Jumlah yang sudah di-refund sebelumnya. */
  refundedQuantity: number;
}

export interface RefundSelection {
  lineId: string;
  quantity: number;
}

export interface RefundLineResult {
  lineId: string;
  quantity: number;
  amount: Minor;
}

export class RefundError extends Error {
  constructor(
    public readonly code: "unknown_line" | "invalid_quantity" | "nothing_to_refund",
    message: string,
  ) {
    super(message);
  }
}

/** Bagian total pesanan untuk tiap baris (jumlah tepat = total). */
export const allocateToLines = (total: Minor, lines: readonly RefundLineInput[]): Minor[] =>
  allocateProportional(total, lines.map((l) => l.weight));

const amountFor = (allocated: Minor, quantity: number, k: number): Minor =>
  k <= 0 ? 0 : k >= quantity ? allocated : mulDivRound(allocated, k, quantity);

export const computeRefund = (total: Minor, lines: readonly RefundLineInput[], selection: readonly RefundSelection[]): { lines: RefundLineResult[]; total: Minor } => {
  const shares = allocateToLines(total, lines);
  const byId = new Map(lines.map((l, i) => [l.id, { line: l, share: shares[i]! }]));
  const asked = new Map<string, number>();
  for (const s of selection) {
    if (!byId.has(s.lineId)) throw new RefundError("unknown_line", `baris ${s.lineId} tidak ada`);
    if (!Number.isInteger(s.quantity) || s.quantity < 1) throw new RefundError("invalid_quantity", "jumlah refund harus integer >= 1");
    asked.set(s.lineId, (asked.get(s.lineId) ?? 0) + s.quantity);
  }
  if (asked.size === 0) throw new RefundError("nothing_to_refund", "tidak ada yang di-refund");
  const out: RefundLineResult[] = [];
  for (const [lineId, quantity] of asked) {
    const { line, share } = byId.get(lineId)!;
    if (line.refundedQuantity + quantity > line.quantity) throw new RefundError("invalid_quantity", `jumlah refund melebihi sisa baris ${lineId}`);
    const amount = amountFor(share, line.quantity, line.refundedQuantity + quantity) - amountFor(share, line.quantity, line.refundedQuantity);
    out.push({ lineId, quantity, amount });
  }
  return { lines: out, total: out.reduce((a, l) => a + l.amount, 0) };
};
