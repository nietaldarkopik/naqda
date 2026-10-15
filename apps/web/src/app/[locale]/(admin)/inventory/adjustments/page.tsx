"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { Button, Card, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { SubjectLines, type SubjectLine } from "@/components/SubjectLines";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { parseDecimal, useOutletChoice, useQtyFormat } from "@/lib/inventory";

interface Adj {
  id: string;
  number: number;
  note: string | null;
  valueChange: number;
  createdAt: string;
  createdBy: string | null;
  lines: { name: string; expected: number; actual: number; delta: number; value: number }[];
}

const pageSize = 15;

export default function AdjustmentsPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const qty = useQtyFormat(locale);
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("inventory.manage");
  const { outlets, outletId, setOutletId } = useOutletChoice();
  const [data, setData] = useState<Paged<Adj> | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<SubjectLine[]>([]);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Adj | null>(null);
  const [busy, setBusy] = useState(false);

  const money = useMemo(() => (v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const when = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);
  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Adj>>(`/inventory/adjustments?page=${page}&pageSize=${pageSize}`));
    } catch (e) {
      failed(e);
    }
  }, [page, failed]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Saldo sistem ditampilkan di samping tiap objek agar kasir stok tahu selisihnya. */
  const withSystem = async (next: SubjectLine[]) => {
    const need = next.filter((l) => l.system === undefined);
    if (need.length) {
      try {
        const res = await api<{ items: { subjectType: string; subjectId: string; quantity: number }[] }>(`/inventory/stock?outletId=${outletId}&pageSize=100`);
        next = next.map((l) => (l.system !== undefined ? l : { ...l, system: res.items.find((r) => r.subjectType === l.subjectType && r.subjectId === l.subjectId)?.quantity ?? 0 }));
      } catch {
        /* saldo sistem hanya informasi */
      }
    }
    setLines(next);
  };

  const create = async () => {
    const parsed = lines.map((l) => ({ subjectType: l.subjectType, subjectId: l.subjectId, actual: parseDecimal(l.quantity), unitCost: l.unitCost.trim() ? parseDecimal(l.unitCost) : undefined }));
    if (parsed.length === 0 || parsed.some((l) => l.actual === null || (l.unitCost !== undefined && l.unitCost === null))) return setError(t("common.invalidNumber"));
    setBusy(true);
    setError("");
    try {
      await api("/inventory/adjustments", { method: "POST", json: { outletId, note: note || null, lines: parsed.map((l) => ({ ...l, unitCost: l.unitCost ?? undefined })) } });
      setCreating(false);
      setLines([]);
      setNote("");
      toast(t("common.saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setError(Object.values(e.fields)[0] ?? e.message);
      else failed(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("inventory.adjustments.title")} subtitle={t("inventory.adjustments.subtitle")}>
        {manage ? (
          <Button onClick={() => { setError(""); setCreating(true); }}>
            <Plus size={16} aria-hidden /> {t("inventory.adjustments.create")}
          </Button>
        ) : null}
      </PageHeader>
      <Card>
        <table className="w-full" data-testid="adjustment-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">#</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("audit.when")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("audit.user")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("inventory.note")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("inventory.adjustments.items")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("inventory.adjustments.valueChange")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.items.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setDetail(a)}>
                <td className="px-4 py-2.5 font-medium">#{a.number}</td>
                <td className="px-4 py-2.5"><span className="ltr-text whitespace-nowrap">{when.format(new Date(a.createdAt))}</span></td>
                <td className="px-4 py-2.5 text-muted">{a.createdBy ?? "-"}</td>
                <td className="px-4 py-2.5 text-muted">{a.note ?? "-"}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{a.lines.length}</td>
                <td className={`px-4 py-2.5 text-end tabular-nums ${a.valueChange < 0 ? "text-danger" : ""}`}>{money(a.valueChange)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{t("common.noData")}</td></tr> : null}
          </tbody>
        </table>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={creating}
        title={t("inventory.adjustments.create")}
        onClose={() => setCreating(false)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button disabled={busy || lines.length === 0} onClick={() => void create()} data-testid="adjustment-submit">{t("common.save")}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("devices.outlet")}>
            {(id) => <Select id={id} value={outletId} onChange={(e) => { setOutletId(e.target.value); setLines([]); }}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
          </Field>
          <Field label={t("inventory.note")}>{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        <p className="text-sm text-muted">{t("inventory.adjustments.help")}</p>
        <SubjectLines lines={lines} onChange={(l) => void withSystem(l)} quantityLabel={t("inventory.adjustments.actual")} costLabel={t("inventory.adjustments.costIfUp")} showSystem error={error} />
      </Modal>

      <Modal open={detail !== null} title={detail ? `${t("inventory.adjustments.title")} #${detail.number}` : ""} onClose={() => setDetail(null)} wide>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1.5 text-start font-medium">{t("common.name")}</th>
              <th className="py-1.5 text-end font-medium">{t("inventory.system")}</th>
              <th className="py-1.5 text-end font-medium">{t("inventory.adjustments.actual")}</th>
              <th className="py-1.5 text-end font-medium">{t("reports.cols.difference")}</th>
              <th className="py-1.5 text-end font-medium">{t("reports.cols.value")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {detail?.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5">{l.name}</td>
                <td className="py-1.5 text-end tabular-nums">{qty(l.expected)}</td>
                <td className="py-1.5 text-end tabular-nums">{qty(l.actual)}</td>
                <td className={`py-1.5 text-end tabular-nums ${l.delta < 0 ? "text-danger" : ""}`}>{l.delta > 0 ? "+" : ""}{qty(l.delta)}</td>
                <td className="py-1.5 text-end tabular-nums">{money(l.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
