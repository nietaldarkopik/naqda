"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Spanduk status langganan di Back Office: sisa uji coba, masa tenggang, dan terkunci (hanya-baca).
 * Tidak tampil untuk langganan normal yang masih lama berakhirnya.
 */
export function BillingBanner() {
  const t = useTranslations("billing");
  const { business } = useAuth();
  const b = business?.billing;
  if (!b) return null;

  let text: string | null = null;
  let tone: "info" | "warn" | "danger" = "info";
  if (b.level === "locked") {
    text = b.status === "suspended" ? t("bannerSuspended") : b.status === "cancelled" ? t("bannerCancelled") : t("bannerLocked");
    tone = "danger";
  } else if (b.level === "grace") {
    text = t("bannerGrace", { days: Math.max(0, b.graceDaysLeft ?? 0) });
    tone = "warn";
  } else if (b.status === "trial" && b.daysLeft !== null) {
    text = t("bannerTrial", { days: Math.max(0, b.daysLeft) });
    tone = b.daysLeft <= 3 ? "warn" : "info";
  } else if (b.daysLeft !== null && b.daysLeft <= 7) {
    text = t("bannerRenew", { days: Math.max(0, b.daysLeft) });
    tone = "warn";
  }
  if (!text) return null;

  const style = tone === "danger" ? "bg-danger-soft text-danger" : tone === "warn" ? "bg-warn-soft text-ink" : "bg-brand-soft text-brand-strong";
  return (
    <div role="status" data-testid="billing-banner" data-level={b.level} className={`mb-5 rounded-lg px-4 py-2.5 text-sm font-medium ${style}`}>
      {text}{" "}
      <Link href="/settings/billing" className="underline" data-testid="billing-link">
        {t("manage")}
      </Link>
    </div>
  );
}
