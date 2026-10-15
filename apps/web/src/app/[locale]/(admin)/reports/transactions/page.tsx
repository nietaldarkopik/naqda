"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { ReportFilters } from "@/components/ReportFilters";
import { Badge, Button, Card, Input, Modal, PageHeader, Pager, useToast } from "@/components/ui";
import { api, apiDownload, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { useReportFilters, type Cell, type Col, type ReportTable } from "@/lib/reports";

type Tab = "success" | "cancelled" | "void_items";
const tabs: Tab[] = ["success", "cancelled", "void_items"];
const pageSize = 25;

interface Detail {
  order: {
    id: string;
    status: string;
    receiptNumber: number | null;
    openedAt: string | null;
    paidAt: string | null;
    table: string | null;
    pax: number | null;
    servedBy: string;
    salesType: string;
    voidReason: string | null;
    totals: { subtotal: number; discountTotal: number; net: number; gratuity: number; tax: number; rounding: number; total: number; refunded: number; change: number };
    taxes: { name: string; amount: number }[];
    gratuities: { name: string; amount: number }[];
    lines: { id: string; name: string; quantity: number; refundedQuantity: number; unitPrice: number; lineDiscount: number; promoDiscount: number; modifiers: { name: string; price: number }[] }[];
    payments: { method: string; tendered: number; applied: number; change: number }[];
    refunds: { id: string; at: string; method: string; total: number; reason: string; by: string; approvedBy: string | null }[];
    activities: { id: string; kind: string; at: string; by: string; approvedBy: string | null }[];
  };
}

export default function TransactionsPage() {
  const t = useTranslations();
  const tx = t as unknown as (key: string) => string;
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { business, can } = useAuth();
  const f = useReportFilters();
  const [tab, setTab] = useState<Tab>("success");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ReportTable | null>(null);
  const [detail, setDetail] = useState<Detail["order"] | null>(null);
  const allowed = can("reports.view");

  const money = useCallback((v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const num = useMemo(() => new Intl.NumberFormat(intlTags[locale]), [locale]);
  const zone = data?.outlets[0]?.timezone;
  const when = useMemo(
    () => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(zone ? { timeZone: zone } : {}) }),
    [locale, zone],
  );
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQuery(q);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [tab, f.query]);

  useEffect(() => {
    if (!allowed) return;
    setData(null);
    api<ReportTable>(`/reports/transactions?${f.query}&tab=${tab}&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`).then(setData).catch(fail);
  }, [allowed, f.query, tab, page, query, fail]);

  const open = async (id: string) => {
    try {
      setDetail((await api<Detail>(`/reports/transactions/${id}`)).order);
    } catch (e) {
      fail(e);
    }
  };

  const cell = (col: Col, row: Record<string, Cell>): React.ReactNode => {
    const v = row[col.key] ?? null;
    if (v === null || v === "") return "-";
    if (col.type === "money") return money(Number(v));
    if (col.type === "int") return num.format(Number(v));
    if (col.type === "datetime") return <span className="ltr-text whitespace-nowrap">{when.format(new Date(String(v)))}</span>;
    return String(v);
  };

  if (!allowed) return <p className="text-muted">{t("errors.forbidden")}</p>;

  return (
    <div className="space-y-5">
      <PageHeader title={t("reports.kinds.transactions")} subtitle={t("reports.kindHints.transactions")} />
      <ReportFilters
        filters={f.filters}
        onPreset={f.setPreset}
        onRange={f.setRange}
        onOutlets={f.setOutlets}
        onExport={() => void apiDownload(`/reports/transactions?${f.query}&tab=${tab}&format=csv`, `naqdi-${tab}-${f.filters.from}_${f.filters.to}.csv`).catch(fail)}
        extra={
          tab === "success" ? (
            <label className="text-sm">
              <span className="mb-1 block text-muted">{t("reports.searchReceipt")}</span>
              <Input type="search" inputMode="numeric" dir="ltr" className="w-40 text-start" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ""))} />
            </label>
          ) : null
        }
      />

      <div className="flex gap-2" role="tablist">
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 rounded-full border px-4 text-sm font-medium ${tab === k ? "border-brand bg-brand text-white" : "border-line bg-surface hover:bg-surface-2"}`}>
            {tx(`reports.tabs.${k}`)}
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="transactions">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                {data?.columns.map((c) => (
                  <th key={c.key} className={`px-4 py-2.5 font-medium ${c.type === "money" || c.type === "int" ? "text-end" : "text-start"}`}>
                    {tx(`reports.cols.${c.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.rows.map((r, i) => (
                <tr key={i} className={tab !== "void_items" ? "cursor-pointer hover:bg-surface-2/60" : ""} onClick={() => tab !== "void_items" && void open(String(r.id))}>
                  {data.columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2.5 ${c.type === "money" || c.type === "int" ? "text-end tabular-nums" : ""}`}>
                      {cell(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
              {data && data.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
              {!data ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data?.total !== undefined ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal open={detail !== null} title={detail?.receiptNumber ? `#${detail.receiptNumber}` : t("reports.transaction")} onClose={() => setDetail(null)} wide>
        {detail ? (
          <div className="space-y-4 text-sm" data-testid="tx-detail">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
              <span>{detail.servedBy}</span>
              <span>{detail.salesType}</span>
              {detail.table ? <span>{t("reports.cols.table")}: {detail.table}</span> : null}
              {detail.pax ? <span>{t("reports.cols.pax")}: {detail.pax}</span> : null}
              {detail.paidAt ? <span className="ltr-text">{when.format(new Date(detail.paidAt))}</span> : null}
              {detail.status === "void" ? <Badge tone="bad">{t("reports.tabs.cancelled")}</Badge> : null}
              {detail.totals.refunded > 0 ? <Badge tone="warn">{t("cashier.refunded")}</Badge> : null}
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {detail.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    {l.quantity}× {l.name}
                    {l.modifiers.length ? <span className="block text-xs text-muted">{l.modifiers.map((m) => m.name).join(", ")}</span> : null}
                    {l.refundedQuantity ? <span className="block text-xs text-danger">{t("cashier.refundedQty", { count: l.refundedQuantity })}</span> : null}
                  </span>
                  <span className="tabular-nums">{money(l.unitPrice * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1">
              {[
                ["subtotal", detail.totals.subtotal],
                ["discounts", -detail.totals.discountTotal],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between">
                  <dt className="text-muted">{tx(`reports.cols.${k}`)}</dt>
                  <dd className="tabular-nums">{money(v as number)}</dd>
                </div>
              ))}
              {[...detail.gratuities, ...detail.taxes].filter((c) => c.amount > 0).map((c, i) => (
                <div key={i} className="flex justify-between">
                  <dt className="text-muted">{c.name}</dt>
                  <dd className="tabular-nums">{money(c.amount)}</dd>
                </div>
              ))}
              {detail.totals.rounding !== 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">{t("cashier.rounding")}</dt>
                  <dd className="tabular-nums">{money(detail.totals.rounding)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold">
                <dt>{t("cashier.total")}</dt>
                <dd className="tabular-nums">{money(detail.totals.total)}</dd>
              </div>
              {detail.totals.refunded > 0 ? (
                <div className="flex justify-between text-danger">
                  <dt>{t("cashier.refunded")}</dt>
                  <dd className="tabular-nums">-{money(detail.totals.refunded)}</dd>
                </div>
              ) : null}
            </dl>
            {detail.payments.length ? (
              <div>
                <h3 className="mb-1 font-semibold">{t("cashier.payment")}</h3>
                {detail.payments.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{tx(`cashier.methods.${p.method}`) || p.method}</span>
                    <span className="tabular-nums">{money(p.tendered)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {detail.refunds.length ? (
              <div>
                <h3 className="mb-1 font-semibold">{t("reports.kinds.refunds")}</h3>
                {detail.refunds.map((r) => (
                  <div key={r.id} className="rounded-lg bg-warn-soft p-2">
                    <div className="flex justify-between">
                      <span>{r.reason}</span>
                      <span className="tabular-nums">{money(r.total)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {r.by}
                      {r.approvedBy ? ` · ${t("reports.cols.approvedBy")}: ${r.approvedBy}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <details>
              <summary className="cursor-pointer text-muted">{t("activities.title")} ({detail.activities.length})</summary>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {detail.activities.map((a) => (
                  <li key={a.id}>
                    <span className="ltr-text">{when.format(new Date(a.at))}</span> · {tx(`activities.kinds.${a.kind}`)} · {a.by}
                    {a.approvedBy ? ` (${a.approvedBy})` : ""}
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => window.print()}>
                {t("cashier.print")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
