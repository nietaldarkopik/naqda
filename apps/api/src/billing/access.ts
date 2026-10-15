import { and, count, eq, isNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { businesses, devices, outlets, type DbHandle } from "@naqdi/db";
import { accessOf, isBusinessStatus, limitsOf, type Access, type PlanLimits } from "@naqdi/domain";
import { AppError } from "../errors";
import type { AppEnv } from "../http";
import type { PosEnv } from "../pos/context";
import { activeEmployeeCount } from "../settings/service";

type Db = DbHandle["db"];

export interface BusinessBilling {
  access: Access;
  plan: string;
  limits: PlanLimits;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  billingInterval: string | null;
}

interface CacheEntry {
  at: number;
  value: BusinessBilling | null;
}
const cache = new Map<string, CacheEntry>();

/** Dipanggil bila pengelola mengubah status/paket agar perubahan berlaku segera (bukan menunggu TTL). */
export const clearBillingCache = (businessId?: string): void => {
  if (businessId) cache.delete(businessId);
  else cache.clear();
};

/**
 * Status langganan bisnis. Dibaca dari database dengan cache singkat (ttlMs) agar tiap permintaan tidak menambah satu kueri;
 * ttlMs 0 = selalu baca (dipakai tes).
 */
export const businessBilling = async (db: Db, businessId: string, ttlMs: number, now = new Date()): Promise<BusinessBilling | null> => {
  const hit = cache.get(businessId);
  if (hit && ttlMs > 0 && now.getTime() - hit.at < ttlMs) {
    // Akses bergantung pada waktu: hitung ulang dari data tersimpan, bukan dari hasil lama.
    return hit.value ? { ...hit.value, access: accessOf({ status: hit.value.access.status, trialEndsAt: hit.value.trialEndsAt, currentPeriodEndsAt: hit.value.currentPeriodEndsAt }, now) } : null;
  }
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const value: BusinessBilling | null = b
    ? {
        access: accessOf({ status: isBusinessStatus(b.status) ? b.status : "active", trialEndsAt: b.trialEndsAt, currentPeriodEndsAt: b.currentPeriodEndsAt }, now),
        plan: b.plan,
        limits: limitsOf(b.plan, b.limits),
        trialEndsAt: b.trialEndsAt,
        currentPeriodEndsAt: b.currentPeriodEndsAt,
        billingInterval: b.billingInterval,
      }
    : null;
  cache.set(businessId, { at: now.getTime(), value });
  return value;
};

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Back Office: saat terkunci hanya baca (data tetap bisa dilihat dan diekspor); semua perubahan ditolak 402.
 * Masa tenggang dan uji coba berjalan penuh. Dipasang SETELAH autentikasi.
 */
export const enforceBackofficeAccess =
  (db: Db, ttlMs: number): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!READ_ONLY.has(c.req.method)) {
      const billing = await businessBilling(db, c.get("auth").businessId, ttlMs);
      if (billing?.access.level === "locked") throw new AppError("payment_required", { extra: { reason: billing.access.reason } });
    }
    await next();
  };

/** Permintaan kasir yang membuat penjualan baru. Sinkron offline, tutup shift, dan baca tetap diizinkan: itu catatan transaksi yang sudah terjadi. */
const NEW_SALE = [
  { method: "POST", path: /\/orders\/?$/ },
  { method: "PUT", path: /\/orders\/[^/]+\/?$/ },
  { method: "POST", path: /\/orders\/[^/]+\/pay\/?$/ },
  { method: "POST", path: /\/orders\/[^/]+\/split\/?$/ },
  { method: "POST", path: /\/shifts\/open\/?$/ },
];

export const enforcePosAccess =
  (db: Db, ttlMs: number): MiddlewareHandler<PosEnv> =>
  async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (NEW_SALE.some((r) => r.method === c.req.method && r.path.test(path))) {
      const billing = await businessBilling(db, c.get("pos").businessId, ttlMs);
      if (billing?.access.level === "locked") throw new AppError("payment_required", { extra: { reason: billing.access.reason } });
    }
    await next();
  };

export type LimitKind = "outlets" | "devices" | "employees";

/** Pemakaian saat ini terhadap batas paket. */
export const usageOf = async (db: Db, businessId: string): Promise<Record<LimitKind, number>> => {
  const [[o], [d], employees] = await Promise.all([
    db.select({ n: count() }).from(outlets).where(and(eq(outlets.businessId, businessId), isNull(outlets.deletedAt))),
    db.select({ n: count() }).from(devices).where(and(eq(devices.businessId, businessId), isNull(devices.revokedAt))),
    activeEmployeeCount(db, businessId),
  ]);
  return { outlets: o?.n ?? 0, devices: d?.n ?? 0, employees };
};

const limitField: Record<LimitKind, keyof PlanLimits> = { outlets: "maxOutlets", devices: "maxDevices", employees: "maxEmployees" };

/** Menolak (409) bila menambah satu lagi melewati batas paket. Pesan generik; angka ada di `extra`. */
export const assertWithinLimit = async (db: Db, businessId: string, kind: LimitKind): Promise<void> => {
  const billing = await businessBilling(db, businessId, 0);
  if (!billing) return;
  const max = billing.limits[limitField[kind]];
  const used = (await usageOf(db, businessId))[kind];
  if (used >= max) throw new AppError("conflict", { messageKey: "billing.limitReached", extra: { kind, max, used, plan: billing.plan } });
};
