/**
 * Siklus hidup langganan dan batas paket. Murni (tanpa DB/UI): dipakai server untuk menegakkan dan UI untuk menampilkan sisa waktu.
 *
 * Status bisnis:
 *  - trial     : masa uji coba (TRIAL_DAYS sejak mendaftar)
 *  - active    : berlangganan; `currentPeriodEndsAt` = akhir periode yang sudah dibayar (null = tanpa batas, mis. dikelola manual)
 *  - past_due  : pembayaran periode berikutnya belum diterima
 *  - suspended : dihentikan pengelola (pelanggaran, tunggakan lama, permintaan)
 *  - cancelled : berhenti berlangganan
 *
 * Akses:
 *  - full   : semuanya berjalan
 *  - grace  : masa tenggang (GRACE_DAYS setelah uji coba/periode habis): masih berjalan penuh, UI memperingatkan
 *  - locked : Back Office hanya-baca (data tetap bisa dilihat dan diekspor); kasir tidak bisa membuat penjualan baru, tetapi
 *             penjualan offline yang sudah terjadi tetap diterima saat sinkron dan shift tetap bisa ditutup.
 */

export const businessStatuses = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type BusinessStatus = (typeof businessStatuses)[number];
export const isBusinessStatus = (v: unknown): v is BusinessStatus => (businessStatuses as readonly unknown[]).includes(v);

export const billingIntervals = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof billingIntervals)[number];

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

export interface PlanLimits {
  maxOutlets: number;
  maxDevices: number;
  maxEmployees: number;
}

/**
 * Batas per paket. ANGKA DI SINI SEMENTARA: harga dan paket final belum diputuskan, jadi jangan dipromosikan.
 * `unlimited` dipakai bisnis yang sudah ada sebelum fitur ini dan bisnis yang dikelola manual.
 */
export const planLimits = {
  basic: { maxOutlets: 1, maxDevices: 3, maxEmployees: 10 },
  pro: { maxOutlets: 5, maxDevices: 15, maxEmployees: 50 },
  unlimited: { maxOutlets: Number.MAX_SAFE_INTEGER, maxDevices: Number.MAX_SAFE_INTEGER, maxEmployees: Number.MAX_SAFE_INTEGER },
} as const satisfies Record<string, PlanLimits>;

export type PlanCode = keyof typeof planLimits;
export const planCodes = Object.keys(planLimits) as PlanCode[];
export const isPlanCode = (v: unknown): v is PlanCode => typeof v === "string" && v in planLimits;

/** Batas efektif: paket, lalu timpaan khusus per bisnis (kesepakatan khusus). Paket tak dikenal diperlakukan tanpa batas agar tidak mengunci. */
export const limitsOf = (plan: string, override?: Partial<PlanLimits> | null): PlanLimits => {
  const base: PlanLimits = isPlanCode(plan) ? planLimits[plan] : planLimits.unlimited;
  return {
    maxOutlets: override?.maxOutlets ?? base.maxOutlets,
    maxDevices: override?.maxDevices ?? base.maxDevices,
    maxEmployees: override?.maxEmployees ?? base.maxEmployees,
  };
};

export interface AccessInput {
  status: BusinessStatus;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
}

export type AccessLevel = "full" | "grace" | "locked";
export type AccessReason = "trial" | "trial_expired" | "active" | "period_expired" | "past_due" | "suspended" | "cancelled";

export interface Access {
  level: AccessLevel;
  reason: AccessReason;
  status: BusinessStatus;
  /** Hari sampai uji coba/periode berakhir (membulat ke atas; negatif bila sudah lewat); null = tanpa batas waktu. */
  daysLeft: number | null;
  /** Sisa hari masa tenggang bila sedang dalam masa tenggang. */
  graceDaysLeft: number | null;
}

const daysBetween = (from: Date, to: Date): number => Math.ceil((to.getTime() - from.getTime()) / DAY_MS);

/** Menentukan akses dari status dan tanggal. `now` diberikan pemanggil agar mudah diuji. */
export const accessOf = (b: AccessInput, now: Date): Access => {
  const result = (level: AccessLevel, reason: AccessReason, daysLeft: number | null, graceDaysLeft: number | null = null): Access => ({ level, reason, status: b.status, daysLeft, graceDaysLeft });

  if (b.status === "suspended") return result("locked", "suspended", null);
  if (b.status === "cancelled") return result("locked", "cancelled", null);

  // trial, active, past_due: semuanya bergantung pada satu tanggal akhir plus masa tenggang.
  const end = b.status === "trial" ? b.trialEndsAt : b.currentPeriodEndsAt;
  if (end === null) return result("full", b.status === "trial" ? "trial" : b.status === "past_due" ? "past_due" : "active", null);

  const daysLeft = daysBetween(now, end);
  if (now.getTime() <= end.getTime()) return result("full", b.status === "trial" ? "trial" : b.status === "past_due" ? "past_due" : "active", daysLeft);

  const graceEnd = new Date(end.getTime() + GRACE_DAYS * DAY_MS);
  const expired = b.status === "trial" ? "trial_expired" : "period_expired";
  if (now.getTime() <= graceEnd.getTime()) return result("grace", expired, daysLeft, daysBetween(now, graceEnd));
  return result("locked", expired, daysLeft);
};

/** Tanggal berakhir uji coba bagi bisnis yang mendaftar pada `from`. */
export const trialEndFrom = (from: Date, days = TRIAL_DAYS): Date => new Date(from.getTime() + days * DAY_MS);

/** Akhir periode berikutnya setelah pembayaran: dihitung dari akhir periode sekarang bila masih berlaku (tidak ada hari hilang), kalau tidak dari `now`. */
export const nextPeriodEnd = (interval: BillingInterval, currentEnd: Date | null, now: Date): Date => {
  const start = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  const d = new Date(start);
  if (interval === "monthly") {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    // 31 Jan + 1 bulan jangan melompat ke Maret: mundur ke hari terakhir bulan itu.
    if (d.getUTCDate() !== day) d.setUTCDate(0);
  } else {
    const month = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    if (d.getUTCMonth() !== month) d.setUTCDate(0); // 29 Feb
  }
  return d;
};
