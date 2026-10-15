import type { DbHandle } from "@naqdi/db";
import { businessBilling } from "./access";

type Db = DbHandle["db"];

/** Ringkasan langganan untuk UI (spanduk uji coba/tenggang/terkunci). Tanggal sebagai teks ISO. */
export const billingView = async (db: Db, businessId: string) => {
  const b = await businessBilling(db, businessId, 0);
  if (!b) return null;
  return {
    status: b.access.status,
    level: b.access.level,
    reason: b.access.reason,
    daysLeft: b.access.daysLeft,
    graceDaysLeft: b.access.graceDaysLeft,
    plan: b.plan,
    interval: b.billingInterval,
    trialEndsAt: b.trialEndsAt ? b.trialEndsAt.toISOString() : null,
    currentPeriodEndsAt: b.currentPeriodEndsAt ? b.currentPeriodEndsAt.toISOString() : null,
    limits: b.limits,
  };
};
