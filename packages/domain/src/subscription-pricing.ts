import { type BillingInterval, type PlanCode } from "./plans";

/**
 * Harga langganan, sumber: https://nqd.my.id/pricing (dibaca 2026-10-16). Satuan terkecil mata uang (rupiah tidak punya sen).
 * Hanya rupiah yang punya daftar harga; bisnis bermata uang lain ditagih lewat faktur khusus yang dibuat pengelola.
 * `unlimited` (Enterprise) tidak dijual mandiri ("Hubungi sales"): angkanya hanya acuan untuk faktur buatan pengelola.
 */
export const planPricesIdr: Record<PlanCode, { monthly: number; yearly: number; selfServe: boolean }> = {
  basic: { monthly: 149_000, yearly: 1_490_000, selfServe: true },
  pro: { monthly: 299_000, yearly: 2_990_000, selfServe: true },
  unlimited: { monthly: 599_000, yearly: 5_990_000, selfServe: false },
};

/** Harga paket untuk satu siklus pada mata uang bisnis; null bila tidak ada daftar harga (bukan rupiah) atau tidak dijual mandiri. */
export const selfServePrice = (plan: string, interval: BillingInterval, currency: string): number | null => {
  if (currency !== "IDR") return null;
  const p = (planPricesIdr as Record<string, { monthly: number; yearly: number; selfServe: boolean } | undefined>)[plan];
  return p && p.selfServe ? p[interval] : null;
};

export const invoiceStatuses = ["open", "pending", "paid", "void"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

/** Cara bayar. `google_play` disiapkan untuk aplikasi seluler (belum diimplementasikan). */
export const paymentProviders = ["manual_transfer", "google_play"] as const;
export type PaymentProvider = (typeof paymentProviders)[number];
