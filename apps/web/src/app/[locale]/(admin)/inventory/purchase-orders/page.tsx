"use client";

import { Eye, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { SubjectLines, type SubjectLine } from "@/components/SubjectLines";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { parseDecimal, useOutletChoice, useQtyFormat } from "@/lib/inventory";

interface Po {
  id: string;
  number: number;
  outlet?: string;
  supplier: string | null;
  status: "waiting" | "partial" | "completed" | "cancelled";
  note: string | null;
  total: number;
  createdAt: string;
  lines?: { id: string; name: string; quantity: number; unitCost: number; receivedQty: number; subtotal: number }[];
}

const pageSize = 15;
const tone = (s: Po["status"]) => (s === "completed" ? "good" : s === "cancelled" ? "bad" : s === "partial" ? "warn" : "neutral");

export default function PurchaseOrdersPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const locale = useLocale() as Locale;
  const qty = useQtyFormat(locale);
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("inventory.manage");
  const { outlets, outletId, setOutletId } = useOutletChoice();
  const [data, setData] = useState<Paged<Po> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<SubjectLine[]>([]);
  const [fulfill, setFulfill] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Po | null>(null);
  const [receive, setReceive] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const money = useMemo(() => (v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const when = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Po>>(`/inventory/purchase-orders?page=${page}&pageSize=${pageSize}${status ? `&status=${status}` : ""}`));
    } catch (e) {
      failed(e);
    }
  }, [page, status, failed]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<Paged<{ id: string; name: string }>>("/suppliers?pageSize=100").then((r) => setSuppliers(r.items)).catch(() => undefined);
  }, []);

  const create = async () => {
    const parsed = lines.map((l) => ({ subjectType: l.subjectType, subjectId: l.subjectId, quantity: parseDecimal(l.quantity), unitCost: parseDecimal(l.unitCost || "0") }));
    if (parsed.length === 0 || parsed.some((l) => l.quantity === null || l.quantity <= 0 || l.unitCost === null)) return setError(t("common.invalidNumber"));
    setBusy(true);
    setError("");
    try {
      await api("/inventory/purchase-orders", { method: "POST", json: { outletId, supplierId: supplierId || null, note: note || null, lines: parsed, fulfill } });
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

  const open = async (po: Po) => {
    try {
      const d = await api<Po>(`/inventory/purchase-orders/${po.id}`);
      setReceive(Object.fromEntries((d.lines ?? []).map((l) => [l.id, String(l.quantity - l.receivedQty)])));
      setDetail(d);
    } catch (e) {
      failed(e);
    }
  };

  const doReceive = async () => {
    if (!detail) return;
    const input = (detail.lines ?? []).map((l) => ({ lineId: l.id, quantity: parseDecimal(receive[l.id] ?? "0") })).filter((l) => l.quantity !== null && l.quantity > 0);
    if (input.length === 0) return;
    setBusy(true);
    try {
      setDetail(await api<Po>(`/inventory/purchase-orders/${detail.id}/fulfill`, { method: "POST", json: { lines: input } }));
      toast(t("inventory.po.received"));
      await load();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    try {
      setDetail(await api<Po>(`/inventory/purchase-orders/${detail.id}/cancel`, { method: "POST", json: {} }));
      await load();
    } catch (e) {
      failed(e);
    }
  };

  const open_ = detail && (detail.status === "waiting" || detail.status === "partial");

  return (
    <div className="space-y-5">
      <PageHeader title={t("inventory.po.title")} subtitle={t("inventory.po.subtitle")}>
        {manage ? (
          <Button onClick={() => { setError(""); setCreating(true); }}>
            <Plus size={16} aria-hidden /> {t("inventory.po.create")}
          </Button>
        ) : null}
      </PageHeader>
      <Card>
        <div className="flex gap-2 border-b border-line p-3">
          <Select aria-label={t("common.status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-48">
            <option value="">{t("inventory.po.allStatus")}</option>
            {(["waiting", "partial", "completed", "cancelled"] as const).map((s) => (
              <option key={s} value={s}>{tx(`inventory.po.status.${s}`)}</option>
            ))}
          </Select>
        </div>
        <table className="w-full" data-testid="po-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("inventory.po.number")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("devices.outlet")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("inventory.po.supplier")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("audit.when")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("reports.cols.total")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.items.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-2.5 font-medium">#{p.number}</td>
                <td className="px-4 py-2.5 text-muted">{p.outlet}</td>
                <td className="px-4 py-2.5 text-muted">{p.supplier ?? "-"}</td>
                <td className="px-4 py-2.5"><span className="ltr-text whitespace-nowrap">{when.format(new Date(p.createdAt))}</span></td>
                <td className="px-4 py-2.5 text-end tabular-nums">{money(p.total)}</td>
                <td className="px-4 py-2.5"><Badge tone={tone(p.status)}>{tx(`inventory.po.status.${p.status}`)}</Badge></td>
                <td className="px-4 py-2.5 text-end">
                  <Button variant="ghost" onClick={() => void open(p)} aria-label={`${t("common.view")} #${p.number}`}>
                    <Eye size={15} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("common.noData")}</td></tr>
            ) : null}
          </tbody>
        </table>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={creating}
        title={t("inventory.po.create")}
        onClose={() => setCreating(false)}
        wide
        footer={
          <>
            <label className="me-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fulfill} onChange={(e) => setFulfill(e.target.checked)} />
              {t("inventory.po.createAndReceive")}
            </label>
            <Button variant="secondary" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button disabled={busy || lines.length === 0} onClick={() => void create()} data-testid="po-submit">
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("devices.outlet")}>
            {(id) => (
              <Select id={id} value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t("inventory.po.supplier")}>
            {(id) => (
              <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">-</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t("inventory.note")}>{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        <SubjectLines lines={lines} onChange={setLines} quantityLabel={t("inventory.quantity")} costLabel={t("inventory.unitCost")} error={error} />
      </Modal>

      <Modal
        open={detail !== null}
        title={detail ? `${t("inventory.po.title")} #${detail.number}` : ""}
        onClose={() => setDetail(null)}
        wide
        footer={
          <>
            {manage && detail?.status === "waiting" ? <Button variant="ghost" className="me-auto text-danger" onClick={() => void cancel()}>{t("inventory.po.cancel")}</Button> : null}
            <Button variant="secondary" onClick={() => setDetail(null)}>{t("common.close")}</Button>
            {manage && open_ ? <Button disabled={busy} onClick={() => void doReceive()} data-testid="po-receive">{t("inventory.po.receive")}</Button> : null}
          </>
        }
      >
        {detail ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4 text-muted">
              <Badge tone={tone(detail.status)}>{tx(`inventory.po.status.${detail.status}`)}</Badge>
              <span>{detail.supplier ?? "-"}</span>
              {detail.note ? <span>{detail.note}</span> : null}
            </div>
            <table className="w-full">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="py-1.5 text-start font-medium">{t("common.name")}</th>
                  <th className="py-1.5 text-end font-medium">{t("inventory.quantity")}</th>
                  <th className="py-1.5 text-end font-medium">{t("inventory.unitCost")}</th>
                  <th className="py-1.5 text-end font-medium">{t("inventory.po.receivedQty")}</th>
                  {open_ && manage ? <th className="py-1.5 text-end font-medium">{t("inventory.po.receiveNow")}</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5">{l.name}</td>
                    <td className="py-1.5 text-end tabular-nums">{qty(l.quantity)}</td>
                    <td className="py-1.5 text-end tabular-nums">{qty(l.unitCost)}</td>
                    <td className="py-1.5 text-end tabular-nums">{qty(l.receivedQty)}</td>
                    {open_ && manage ? (
                      <td className="py-1.5 text-end">
                        <Input aria-label={`${t("inventory.po.receiveNow")} ${l.name}`} inputMode="decimal" dir="ltr" className="ms-auto w-24 text-start" value={receive[l.id] ?? ""} onChange={(e) => setReceive((r) => ({ ...r, [l.id]: e.target.value }))} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end font-semibold">{t("reports.cols.total")}: {money(detail.total)}</div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
