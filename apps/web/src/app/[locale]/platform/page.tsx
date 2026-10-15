"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { platformApi } from "@/lib/platformApi";

interface Overview {
  pendingInvoices: number;
  total: number;
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  byCountry: Record<string, number>;
  byCurrency: Record<string, number>;
  access: { full: number; grace: number; locked: number };
  signups: { last7d: number; last30d: number };
  trialsExpiringSoon: { id: string; name: string; endsAt: string; daysLeft: number }[];
}

const Stat = ({ label, value, testid, tone }: { label: string; value: number; testid: string; tone?: "warn" | "danger" }) => (
  <Card className="p-4">
    <div className="text-sm text-muted">{label}</div>
    <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : ""}`} data-testid={testid}>
      {value}
    </div>
  </Card>
);

const Breakdown = ({ title, data }: { title: string; data: Record<string, number> }) => (
  <Card className="p-4">
    <div className="mb-2 text-sm font-medium">{title}</div>
    <ul className="space-y-1 text-sm">
      {Object.entries(data).slice(0, 8).map(([k, v]) => (
        <li key={k} className="flex justify-between gap-3">
          <span className="text-muted">{k}</span>
          <span className="tabular-nums">{v}</span>
        </li>
      ))}
    </ul>
  </Card>
);

export default function PlatformOverviewPage() {
  const t = useTranslations("platformUi");
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    platformApi<Overview>("/overview").then(setO).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!o) return <p className="text-muted">{t("loading")}</p>;
  const status = (k: string) => t(`status.${k}` as never);
  return (
    <div className="space-y-5" data-testid="platform-overview">
      <h1 className="text-xl font-semibold">{t("navOverview")}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={t("total")} value={o.total} testid="stat-total" />
        <Stat label={t("signups7")} value={o.signups.last7d} testid="stat-signups7" />
        <Stat label={t("signups30")} value={o.signups.last30d} testid="stat-signups30" />
        <Stat label={t("level.grace")} value={o.access.grace} testid="stat-grace" tone="warn" />
        <Stat label={t("level.locked")} value={o.access.locked} testid="stat-locked" tone="danger" />
      </div>
      <Link href="/platform/invoices" className="block" data-testid="pending-invoices-link">
        <Stat label={t("pendingInvoices")} value={o.pendingInvoices} testid="stat-pending-invoices" {...(o.pendingInvoices > 0 ? { tone: "warn" as const } : {})} />
      </Link>
      <div className="grid gap-3 md:grid-cols-4">
        <Breakdown title={t("byStatus")} data={Object.fromEntries(Object.entries(o.byStatus).map(([k, v]) => [status(k), v]))} />
        <Breakdown title={t("byPlan")} data={o.byPlan} />
        <Breakdown title={t("byCountry")} data={o.byCountry} />
        <Breakdown title={t("byCurrency")} data={o.byCurrency} />
      </div>
      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">{t("expiringSoon")}</div>
        {o.trialsExpiringSoon.length === 0 ? (
          <p className="text-sm text-muted">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm" data-testid="expiring-list">
            {o.trialsExpiringSoon.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/platform/businesses/${x.id}`} className="font-medium text-brand underline">
                  {x.name}
                </Link>
                <span className="text-muted">{t("daysLeft", { count: Math.max(0, x.daysLeft) })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
