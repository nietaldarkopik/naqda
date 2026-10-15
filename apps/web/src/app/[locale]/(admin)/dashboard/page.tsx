"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { AreaChart, BarChart, ShareBars } from "@/components/charts";
import { ReportFilters } from "@/components/ReportFilters";
import { Card, PageHeader, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { useReportFilters } from "@/lib/reports";

interface Bucket {
  key: string;
  orders: number;
  grossSales: number;
  netSales: number;
}
interface Dashboard {
  range: { from: string; to: string };
  outlets: { id: string; name: string }[];
  metrics: Record<string, number>;
  daily: Bucket[];
  hourly: Bucket[];
  weekday: Bucket[];
  topItems: { key: string; name: string; sold: number; grossSales: number; netSales: number; grossProfit: number }[];
  categories: { key: string; name: string; netSales: number }[];
  outletComparison: ({ outletId: string; name: string } & Record<string, number | string>)[];
  tables: { orders: number; pax: number; revenue: number; revenuePerPax: number; averageMinutes: number };
}

const kpis = ["grossSales", "discounts", "refunds", "netSales", "grossProfit", "totalCollected"] as const;

export default function DashboardPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { business, can, user } = useAuth();
  const f = useReportFilters();
  const [data, setData] = useState<Dashboard | null>(null);
  const allowed = can("reports.view");

  const money = useMemo(() => (v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const num = useMemo(() => new Intl.NumberFormat(intlTags[locale]), [locale]);

  useEffect(() => {
    if (!allowed) return;
    setData(null);
    api<Dashboard>(`/reports/dashboard?${f.query}`)
      .then(setData)
      .catch((e) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"));
  }, [allowed, f.query, toast, t]);

  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlTags[locale], { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d)))); // 1 Jan 2023 = Minggu
  }, [locale]);
  const dayLabel = (iso: string) => iso.slice(5).replace("-", "/");

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.welcome", { name: user?.name ?? "" })} />
        <p className="text-muted">{t("errors.forbidden")}</p>
      </div>
    );
  }

  const m = data?.metrics;
  return (
    <div className="space-y-5">
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.welcome", { name: user?.name ?? "" })} />
      <ReportFilters filters={f.filters} onPreset={f.setPreset} onRange={f.setRange} onOutlets={f.setOutlets} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="kpis">
        {kpis.map((k) => (
          <Card key={k} className="p-4">
            <div className="text-sm text-muted">{t(`reports.metrics.${k}`)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`kpi-${k}`}>
              {m ? money(m[k] ?? 0) : "-"}
            </div>
          </Card>
        ))}
        <Card className="p-4">
          <div className="text-sm text-muted">{t("reports.metrics.orders")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid="kpi-orders">
            {m ? num.format(m.orders ?? 0) : "-"}
          </div>
          <div className="text-xs text-muted">
            {t("reports.metrics.averageOrder")}: {m ? money(m.averageOrder ?? 0) : "-"}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t("reports.charts.daily")}</h2>
          <AreaChart ariaLabel={t("reports.charts.daily")} format={money} data={(data?.daily ?? []).map((d) => ({ label: dayLabel(d.key), value: d.grossSales }))} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t("reports.charts.hourly")}</h2>
          <BarChart ariaLabel={t("reports.charts.hourly")} format={money} data={(data?.hourly ?? []).map((d) => ({ label: d.key.padStart(2, "0"), value: d.grossSales }))} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t("reports.charts.weekday")}</h2>
          <BarChart ariaLabel={t("reports.charts.weekday")} format={money} data={(data?.weekday ?? []).map((d) => ({ label: weekdayNames[Number(d.key)] ?? d.key, value: d.grossSales }))} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">{t("reports.charts.categories")}</h2>
          {data && data.categories.length === 0 ? <p className="text-sm text-muted">{t("common.noData")}</p> : null}
          <ShareBars rows={(data?.categories ?? []).slice(0, 8).map((c) => ({ label: c.name || t("reports.uncategorized"), value: Math.max(0, c.netSales), text: money(c.netSales) }))} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <div className="border-b border-line px-4 py-3 font-semibold">{t("reports.charts.topItems")}</div>
          <table className="w-full">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("reports.cols.name")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("reports.cols.sold")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("reports.cols.grossSales")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("reports.cols.netSales")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("reports.cols.grossProfit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.topItems.map((i) => (
                <tr key={i.key}>
                  <td className="px-4 py-2">{i.name}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{num.format(i.sold)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{money(i.grossSales)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{money(i.netSales)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{money(i.grossProfit)}</td>
                </tr>
              ))}
              {data && data.topItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">{t("reports.charts.tables")}</h2>
          {[
            ["tableOrders", data?.tables.orders],
            ["pax", data?.tables.pax],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between text-sm">
              <span className="text-muted">{t(`reports.tableStats.${k}`)}</span>
              <span className="tabular-nums">{v === undefined ? "-" : num.format(v as number)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t("reports.tableStats.revenuePerPax")}</span>
            <span className="tabular-nums">{data ? money(data.tables.revenuePerPax) : "-"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t("reports.tableStats.averageMinutes")}</span>
            <span className="tabular-nums">{data ? num.format(data.tables.averageMinutes) : "-"}</span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="border-b border-line px-4 py-3 font-semibold">{t("reports.charts.outletComparison")}</div>
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="outlet-comparison">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("reports.cols.outlet")}</th>
                {["orders", "grossSales", "discounts", "refunds", "netSales", "totalCollected"].map((k) => (
                  <th key={k} className="px-4 py-2 text-end font-medium">
                    {t(`reports.cols.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.outletComparison.map((o) => (
                <tr key={o.outletId}>
                  <td className="px-4 py-2 font-medium">{o.name}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{num.format(Number(o.orders))}</td>
                  {["grossSales", "discounts", "refunds", "netSales", "totalCollected"].map((k) => (
                    <td key={k} className="px-4 py-2 text-end tabular-nums">
                      {money(Number(o[k]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
