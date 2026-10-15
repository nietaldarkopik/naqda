"use client";

import { Bell, History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { parseDecimal, useOutletChoice, useQtyFormat } from "@/lib/inventory";

interface Row {
  subjectType: "variant" | "ingredient";
  subjectId: string;
  name: string;
  unit: string;
  kind: string;
  quantity: number;
  avgCost: number;
  alertLow: number;
  value: number;
  status: "out" | "low" | "ok";
}
interface Movement {
  id: string;
  at: string;
  kind: string;
  delta: number;
  unitCost: number;
  value: number;
  balanceAfter: number;
  note: string | null;
  user: string | null;
}

const pageSize = 25;
const tone = (s: Row["status"]) => (s === "out" ? "bad" : s === "low" ? "warn" : "good");

export default function StockPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const locale = useLocale() as Locale;
  const qty = useQtyFormat(locale);
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("inventory.manage");
  const { outlets, outletId, setOutletId } = useOutletChoice();
  const [data, setData] = useState<(Paged<Row> & { totalValue: number }) | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<{ row: Row; items: Movement[] } | null>(null);
  const [alert, setAlert] = useState<Row | null>(null);
  const [alertText, setAlertText] = useState("");

  const money = useMemo(() => (v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const when = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  const load = useCallback(async () => {
    if (!outletId) return;
    const p = new URLSearchParams({ outletId, page: String(page), pageSize: String(pageSize), q: query });
    if (type) p.set("type", type);
    if (status) p.set("status", status);
    try {
      setData(await api<Paged<Row> & { totalValue: number }>(`/inventory/stock?${p}`));
    } catch (e) {
      failed(e);
    }
  }, [outletId, page, query, type, status, failed]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQuery(q);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const openHistory = async (row: Row) => {
    try {
      const r = await api<{ items: Movement[] }>(`/inventory/movements?outletId=${outletId}&subjectType=${row.subjectType}&subjectId=${row.subjectId}&pageSize=50`);
      setHistory({ row, items: r.items });
    } catch (e) {
      failed(e);
    }
  };

  const saveAlert = async () => {
    const v = parseDecimal(alertText);
    if (!alert || v === null) return toast(t("common.invalidNumber"), "error");
    try {
      await api("/inventory/stock/alert", { method: "PUT", json: { outletId, subjectType: alert.subjectType, subjectId: alert.subjectId, alertLow: v } });
      setAlert(null);
      toast(t("common.saved"));
      await load();
    } catch (e) {
      failed(e);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("inventory.stock.title")} subtitle={t("inventory.stock.subtitle")}>
        <Select aria-label={t("devices.outlet")} value={outletId} onChange={(e) => { setOutletId(e.target.value); setPage(1); }} className="max-w-56">
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </PageHeader>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select aria-label={t("inventory.stock.type")} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="max-w-40">
            <option value="">{t("inventory.stock.allTypes")}</option>
            <option value="variant">{t("inventory.kind.variant")}</option>
            <option value="ingredient">{t("inventory.kind.ingredient")}</option>
          </Select>
          <Select aria-label={t("common.status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-40">
            <option value="">{t("inventory.stock.allStatus")}</option>
            <option value="out">{t("inventory.stock.status.out")}</option>
            <option value="low">{t("inventory.stock.status.low")}</option>
            <option value="ok">{t("inventory.stock.status.ok")}</option>
          </Select>
          <div className="ms-auto text-sm text-muted">
            {t("inventory.stock.totalValue")}: <span className="font-semibold text-ink tabular-nums" data-testid="stock-total">{data ? money(data.totalValue) : "-"}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="stock-table">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inventory.stock.type")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("inventory.stock.quantity")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("inventory.stock.avgCost")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("reports.cols.value")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("inventory.stock.alert")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((r) => (
                <tr key={`${r.subjectType}:${r.subjectId}`} className="hover:bg-surface-2/60">
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5 text-muted">{r.subjectType === "variant" ? t("inventory.kind.variant") : t(`inventory.ingredients.${r.kind === "semi" ? "semi" : "raw"}`)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">
                    {qty(r.quantity)} <span className="text-xs text-muted">{r.unit}</span>
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{qty(r.avgCost)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{money(r.value)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-muted">{r.alertLow > 0 ? qty(r.alertLow) : "-"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={tone(r.status)}>{tx(`inventory.stock.status.${r.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => void openHistory(r)} aria-label={`${t("inventory.stock.history")} ${r.name}`} title={t("inventory.stock.history")}>
                        <History size={15} aria-hidden />
                      </Button>
                      {manage ? (
                        <Button variant="ghost" onClick={() => { setAlertText(String(r.alertLow)); setAlert(r); }} aria-label={`${t("inventory.stock.alert")} ${r.name}`} title={t("inventory.stock.alert")}>
                          <Bell size={15} aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    {t("inventory.stock.empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal open={history !== null} title={history?.row.name ?? ""} onClose={() => setHistory(null)} wide>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1.5 text-start font-medium">{t("audit.when")}</th>
              <th className="py-1.5 text-start font-medium">{t("activities.kind")}</th>
              <th className="py-1.5 text-end font-medium">{t("inventory.stock.change")}</th>
              <th className="py-1.5 text-end font-medium">{t("inventory.stock.balance")}</th>
              <th className="py-1.5 text-end font-medium">{t("reports.cols.value")}</th>
              <th className="py-1.5 text-start font-medium">{t("audit.user")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {history?.items.map((m) => (
              <tr key={m.id}>
                <td className="py-1.5"><span className="ltr-text whitespace-nowrap">{when.format(new Date(m.at))}</span></td>
                <td className="py-1.5">{tx(`inventory.movement.${m.kind}`)}{m.note ? <span className="block text-xs text-muted">{m.note}</span> : null}</td>
                <td className={`py-1.5 text-end tabular-nums ${m.delta < 0 ? "text-danger" : ""}`}>{m.delta > 0 ? "+" : ""}{qty(m.delta)}</td>
                <td className="py-1.5 text-end tabular-nums">{qty(m.balanceAfter)}</td>
                <td className="py-1.5 text-end tabular-nums">{money(m.value)}</td>
                <td className="py-1.5 text-muted">{m.user ?? "-"}</td>
              </tr>
            ))}
            {history && history.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">{t("common.noData")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Modal>

      <Modal
        open={alert !== null}
        title={t("inventory.stock.alert")}
        onClose={() => setAlert(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAlert(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => void saveAlert()}>{t("common.save")}</Button>
          </>
        }
      >
        <p className="font-medium">{alert?.name}</p>
        <Field label={t("inventory.stock.alertLevel", { unit: alert?.unit ?? "" })} hint={t("inventory.stock.alertHint")}>
          {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={alertText} onChange={(e) => setAlertText(e.target.value)} />}
        </Field>
      </Modal>
    </div>
  );
}
