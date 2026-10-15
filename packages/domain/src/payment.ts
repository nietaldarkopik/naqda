import type { Minor } from "./money";

/**
 * Penyelesaian pembayaran. Murni.
 * - Satu pesanan bisa dibayar dengan beberapa metode (pisah bayar).
 * - Kembalian HANYA berasal dari tunai: pembayaran non-tunai (kartu, e-wallet, QRIS, transfer) tidak boleh
 *   melebihi sisa tagihan.
 * - Pembayaran sebagian diperbolehkan: `remaining` > 0 dan `fullyPaid` = false.
 */

export interface PaymentInput {
  /** "cash" untuk tunai; metode lain dianggap non-tunai. */
  method: string;
  /** Jumlah yang diserahkan/dibebankan. Untuk tunai boleh melebihi sisa (menghasilkan kembalian). */
  amount: Minor;
}

export interface AppliedPayment {
  method: string;
  tendered: Minor;
  /** Bagian yang benar-benar mengurangi tagihan. */
  applied: Minor;
  change: Minor;
}

export interface Settlement {
  total: Minor;
  paid: Minor;
  remaining: Minor;
  change: Minor;
  fullyPaid: boolean;
  /** Tunai bersih yang masuk laci (tunai diterima dikurangi kembalian). */
  cashReceived: Minor;
  payments: AppliedPayment[];
}

export class PaymentError extends Error {
  constructor(
    public readonly code: "invalid_amount" | "noncash_overpay" | "cash_not_needed",
    message: string,
  ) {
    super(message);
  }
}

export const isCash = (method: string): boolean => method === "cash";

export const settle = (total: Minor, payments: readonly PaymentInput[]): Settlement => {
  if (!Number.isInteger(total) || total < 0) throw new RangeError("total harus integer >= 0");
  for (const p of payments) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw new PaymentError("invalid_amount", "jumlah pembayaran harus integer > 0");
  }

  // Non-tunai dulu agar jumlah tunai yang dibutuhkan diketahui, lalu tunai menutup sisanya.
  let remaining = total;
  const applied: AppliedPayment[] = payments.map((p) => ({ method: p.method, tendered: p.amount, applied: 0, change: 0 }));

  payments.forEach((p, i) => {
    if (isCash(p.method)) return;
    if (p.amount > remaining) throw new PaymentError("noncash_overpay", `pembayaran ${p.method} melebihi sisa tagihan`);
    applied[i]!.applied = p.amount;
    remaining -= p.amount;
  });

  const cashIdx = payments.map((p, i) => (isCash(p.method) ? i : -1)).filter((i) => i >= 0);
  const cashTendered = cashIdx.reduce((a, i) => a + payments[i]!.amount, 0);
  if (cashTendered > 0 && remaining === 0) {
    throw new PaymentError("cash_not_needed", "tagihan sudah lunas tanpa tunai");
  }
  const cashApplied = Math.min(cashTendered, remaining);
  const change = cashTendered - cashApplied;

  // Kembalian dicatat pada pembayaran tunai terakhir; bagian terapan dibagi berurutan.
  let left = cashApplied;
  cashIdx.forEach((i, n) => {
    const take = Math.min(payments[i]!.amount, left);
    applied[i]!.applied = take;
    left -= take;
    if (n === cashIdx.length - 1) applied[i]!.change = change;
  });

  remaining -= cashApplied;
  return {
    total,
    paid: total - remaining,
    remaining,
    change,
    fullyPaid: remaining === 0,
    cashReceived: cashApplied,
    payments: applied,
  };
};
