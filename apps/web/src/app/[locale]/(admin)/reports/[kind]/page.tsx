"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { ReportFilters } from "@/components/ReportFilters";
import { Card, PageHeader, useToast } from "@/components/ui";
import { api, apiDownload, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { useReportFilters, type Cell, type Col, type ReportTable } from "@/lib/reports";

const kinds = ["summary", "outlets", "payments", "sales-types", "items", "categories", "brands", "modifiers", "discounts", "taxes", "gratuity", "collected-by", "tables", "shifts", "inventory"] as const;
const countMetrics = new Set(["orders", "itemsSold"]);

export default function ReportPage() {
  const t = useTranslations();
  const tx = t as unknown as (key: string) => string;
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { kind } = useParams<{ kind: string }>();
  const { business, can } = useAuth();
  const f = useReportFilters();
  const [data, setData] = useState<(ReportTable & { metrics?: Record<string, number> }) | null>(null);
  const [exporting, setExporting] = useState(false);
  const valid = (kinds as readonly string[]).includes(kind);
  const allowed = can("reports.view");

  const money = useCallback((v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const num = useMemo(() => new Intl.NumberFormat(intlTags[locale]), [locale]);
  const qtyFmt = useMemo(() => new Intl.NumberFormat(intlTags[locale], { maximumFractionDigits: 3 }), [locale]);

  useEffect(() => {
    if (!valid || !allowed) return;
    setData(null);
    api<ReportTable & { metrics?: Record<string, number> }>(`/reports/${kind}?${f.query}`)
      .then(setData)
      .catch((e) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"));
  }, [valid, allowed, kind, f.query, toast, t]);

  const zone = data?.outlets[0]?.timezone;
  const when = useMemo(
    () => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(zone ? { timeZone: zone } : {}) }),
    [locale, zone],
  );

  const cell = (col: Col, row: Record<string, Cell>): React.ReactNode => {
    const v = row[col.key] ?? null;
    if (v === null || v === undefined) return "-";
    switch (col.type) {
      case "money":
        return money(Number(v));
      case "int":
      case "minutes":
        return num.format(Number(v));
      case "qty":
        return qtyFmt.format(Number(v));
      case "percent":
        return `${(Number(v) / 100).toFixed(1)}%`;
      case "datetime":
        return <span className="ltr-text whitespace-nowrap">{when.format(new Date(String(v)))}</span>;
      default: {
        const s = String(v);
        if (col.key === "method") return tx(`cashier.methods.${s}`) || s;
        if (col.key === "type") return tx(`reports.types.${s}`) || s;
        if (col.key === "name" && s === "") return row.type === "manual" ? tx("reports.types.manual") : tx("reports.uncategorized");
        return s;
      }
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      await apiDownload(`/reports/${kind}?${f.query}&format=csv`, `naqdi-${kind}-${f.filters.from}_${f.filters.to}.csv`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    } finally {
      setExporting(false);
    }
  };

  if (!valid) return <p className="text-muted">{t("errors.notFound")}</p>;
  if (!allowed) return <p className="text-muted">{t("errors.forbidden")}</p>;
  const title = tx(`reports.kinds.${kind}`);

  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={tx(`reports.kindHints.${kind}`)} />
      <ReportFilters filters={f.filters} onPreset={f.setPreset} onRange={f.setRange} onOutlets={f.setOutlets} onExport={() => void doExport()} exporting={exporting} />

      {kind === "summary" ? (
        <Card>
          <dl className="divide-y divide-line" data-testid="summary">
            {data?.metrics
              ? Object.entries(data.metrics).map(([k, v]) => (
                  <div key={k} className={`flex items-center justify-between px-4 py-3 ${k === "netSales" || k === "totalCollected" ? "bg-surface-2 font-semibold" : ""}`}>
                    <dt>{tx(`reports.metrics.${k}`)}</dt>
                    <dd className="tabular-nums" data-testid={`metric-${k}`}>
                      {countMetrics.has(k) ? num.format(v) : money(v)}
                    </dd>
                  </div>
                ))
              : null}
            {!data ? <div className="px-4 py-10 text-center text-muted">{t("common.loading")}</div> : null}
          </dl>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">{t("reports.summaryNote")}</p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="report-table">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>
                  {data?.columns.map((c) => (
                    <th key={c.key} className={`px-4 py-2.5 font-medium ${c.type === "text" || c.type === "datetime" ? "text-start" : "text-end"}`}>
                      {tx(`reports.cols.${c.key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-surface-2/60">
                    {data.columns.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 ${c.type === "text" || c.type === "datetime" ? "" : "text-end tabular-nums"}`}>
                        {cell(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
                {data && data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={data.columns.length} className="px-4 py-10 text-center text-muted">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : null}
                {!data ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted">
                      {t("common.loading")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {data?.totals && data.rows.length > 0 ? (
                <tfoot className="border-t-2 border-line bg-surface-2 font-semibold">
                  <tr>
                    {data.columns.map((c, i) => (
                      <td key={c.key} className={`px-4 py-2.5 ${c.type === "text" || c.type === "datetime" ? "" : "text-end tabular-nums"}`}>
                        {i === 0 ? t("reports.total") : data.totals![c.key] === undefined ? "" : cell(c, data.totals!)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {kind === "items" || kind === "categories" || kind === "brands" ? <p className="border-t border-line px-4 py-3 text-xs text-muted">{t("reports.itemNote")}</p> : null}
        </Card>
      )}
    </div>
  );
}
