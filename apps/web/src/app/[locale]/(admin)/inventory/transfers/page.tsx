"use client";

import { Eye, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { SubjectLines, type SubjectLine } from "@/components/SubjectLines";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { parseDecimal, useOutletChoice, useQtyFormat } from "@/lib/inventory";

interface Tr {
  id: string;
  number: number;
  from: string;
  to: string;
  status: "in_transit" | "received" | "cancelled";
  note: string | null;
  createdAt: string;
  lines?: { id: string; name: string; quantity: number; receivedQty: number }[];
}

const pageSize = 15;
const tone = (s: Tr["status"]) => (s === "received" ? "good" : s === "cancelled" ? "bad" : "warn");

export default function TransfersPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const locale = useLocale() as Locale;
  const qty = useQtyFormat(locale);
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("inventory.manage");
  const { outlets, outletId } = useOutletChoice();
  const [data, setData] = useState<Paged<Tr> | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<SubjectLine[]>([]);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Tr | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const when = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);
  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Tr>>(`/inventory/transfers?page=${page}&pageSize=${pageSize}`));
    } catch (e) {
      failed(e);
    }
  }, [page, failed]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setFrom((f) => f || outletId);
    setTo((x) => x || outlets.find((o) => o.id !== outletId)?.id || "");
  }, [outletId, outlets]);

  const create = async () => {
    const parsed = lines.map((l) => ({ subjectType: l.subjectType, subjectId: l.subjectId, quantity: parseDecimal(l.quantity) }));
    if (parsed.length === 0 || parsed.some((l) => l.quantity === null || l.quantity <= 0)) return setError(t("common.invalidNumber"));
    setBusy(true);
    setError("");
    try {
      await api("/inventory/transfers", { method: "POST", json: { fromOutletId: from, toOutletId: to, note: note || null, lines: parsed } });
      setCreating(false);
      setLines([]);
      setNote("");
      toast(t("inventory.transfers.sent"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setError(Object.values(e.fields)[0] ?? e.message);
      else failed(e);
    } finally {
      setBusy(false);
    }
  };

  const open = async (tr: Tr) => {
    try {
      const d = await api<Tr>(`/inventory/transfers/${tr.id}`);
      setReceived(Object.fromEntries((d.lines ?? []).map((l) => [l.id, String(l.quantity)])));
      setDetail(d);
    } catch (e) {
      failed(e);
    }
  };

  const receive = async () => {
    if (!detail) return;
    const input = (detail.lines ?? []).map((l) => ({ lineId: l.id, quantity: parseDecimal(received[l.id] ?? "0") }));
    if (input.some((l) => l.quantity === null)) return toast(t("common.invalidNumber"), "error");
    setBusy(true);
    try {
      setDetail(await api<Tr>(`/inventory/transfers/${detail.id}/receive`, { method: "POST", json: { lines: input } }));
      toast(t("inventory.transfers.receivedDone"));
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
      setDetail(await api<Tr>(`/inventory/transfers/${detail.id}/cancel`, { method: "POST", json: {} }));
      await load();
    } catch (e) {
      failed(e);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("inventory.transfers.title")} subtitle={t("inventory.transfers.subtitle")}>
        {manage ? (
          <Button onClick={() => { setError(""); setCreating(true); }}>
            <Plus size={16} aria-hidden /> {t("inventory.transfers.create")}
          </Button>
        ) : null}
      </PageHeader>
      <Card>
        <table className="w-full" data-testid="transfer-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">#</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("inventory.transfers.from")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("inventory.transfers.to")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("audit.when")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.items.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-2.5 font-medium">#{r.number}</td>
                <td className="px-4 py-2.5">{r.from}</td>
                <td className="px-4 py-2.5">{r.to}</td>
                <td className="px-4 py-2.5"><span className="ltr-text whitespace-nowrap">{when.format(new Date(r.createdAt))}</span></td>
                <td className="px-4 py-2.5"><Badge tone={tone(r.status)}>{tx(`inventory.transfers.status.${r.status}`)}</Badge></td>
                <td className="px-4 py-2.5 text-end">
                  <Button variant="ghost" onClick={() => void open(r)} aria-label={`${t("common.view")} #${r.number}`}>
                    <Eye size={15} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{t("common.noData")}</td></tr> : null}
          </tbody>
        </table>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={creating}
        title={t("inventory.transfers.create")}
        onClose={() => setCreating(false)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button disabled={busy || lines.length === 0 || from === to} onClick={() => void create()} data-testid="transfer-submit">{t("inventory.transfers.send")}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("inventory.transfers.from")}>
            {(id) => <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
          </Field>
          <Field label={t("inventory.transfers.to")}>
            {(id) => <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
          </Field>
          <Field label={t("inventory.note")}>{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        <SubjectLines lines={lines} onChange={setLines} quantityLabel={t("inventory.quantity")} error={error} />
      </Modal>

      <Modal
        open={detail !== null}
        title={detail ? `${t("inventory.transfers.title")} #${detail.number}` : ""}
        onClose={() => setDetail(null)}
        footer={
          <>
            {manage && detail?.status === "in_transit" ? <Button variant="ghost" className="me-auto text-danger" onClick={() => void cancel()}>{t("inventory.transfers.cancel")}</Button> : null}
            <Button variant="secondary" onClick={() => setDetail(null)}>{t("common.close")}</Button>
            {manage && detail?.status === "in_transit" ? <Button disabled={busy} onClick={() => void receive()} data-testid="transfer-receive">{t("inventory.transfers.receive")}</Button> : null}
          </>
        }
      >
        {detail ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-3 text-muted">
              <Badge tone={tone(detail.status)}>{tx(`inventory.transfers.status.${detail.status}`)}</Badge>
              <span>{detail.from} → {detail.to}</span>
              {detail.note ? <span>{detail.note}</span> : null}
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {detail.lines?.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    {l.name}
                    <span className="block text-xs text-muted">{t("inventory.transfers.sentQty")}: {qty(l.quantity)}{detail.status === "received" ? ` · ${t("inventory.po.receivedQty")}: ${qty(l.receivedQty)}` : ""}</span>
                  </span>
                  {manage && detail.status === "in_transit" ? (
                    <Input aria-label={`${t("inventory.po.receivedQty")} ${l.name}`} inputMode="decimal" dir="ltr" className="w-24 text-start" value={received[l.id] ?? ""} onChange={(e) => setReceived((r) => ({ ...r, [l.id]: e.target.value }))} />
                  ) : null}
                </li>
              ))}
            </ul>
            {detail.status === "in_transit" ? <p className="text-xs text-muted">{t("inventory.transfers.shortHint")}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
