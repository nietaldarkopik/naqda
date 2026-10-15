"use client";

import { Download, History, Pencil, Plus, Star, StarOff, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, apiDownload, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  member: boolean;
  memberSince: string | null;
  points: number;
  lifetimeSpending: number;
  visits: number;
  createdAt: string;
}
interface Detail extends Customer {
  ledger: { id: string; kind: string; points: number; balanceAfter: number; note: string | null; at: string }[];
}
interface Listing {
  items: Customer[];
  total: number;
  summary: { customers: number; members: number; nonMembers: number; redeemed: number };
}

const pageSize = 20;
const emptyForm = { name: "", phone: "", email: "", note: "", enroll: false };

export default function CustomersPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("customers.manage");
  const [data, setData] = useState<Listing | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [member, setMember] = useState("");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [adjust, setAdjust] = useState({ points: "", note: "" });

  const money = useMemo(() => (v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  const num = useMemo(() => new Intl.NumberFormat(intlTags[locale]), [locale]);
  const when = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const day = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit" }), [locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  const load = useCallback(async () => {
    try {
      setData(await api<Listing>(`/customers?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}${member ? `&member=${member}` : ""}`));
    } catch (e) {
      failed(e);
    }
  }, [page, query, member, failed]);
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

  const openForm = (c: Customer | "new") => {
    setErrors({});
    setForm(c === "new" ? emptyForm : { name: c.name, phone: c.phone ?? "", email: c.email ?? "", note: c.note ?? "", enroll: false });
    setEditing(c);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body = { name: form.name, phone: form.phone || null, email: form.email || null, note: form.note || null };
    try {
      if (editing === "new") await api("/customers", { method: "POST", json: { ...body, enroll: form.enroll } });
      else if (editing) await api(`/customers/${editing.id}`, { method: "PATCH", json: body });
      setEditing(null);
      toast(t("common.saved"));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else failed(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/customers/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await load();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleMember = async (c: Customer) => {
    try {
      await api(`/customers/${c.id}/${c.member ? "unenroll" : "enroll"}`, { method: "POST", json: {} });
      toast(t("common.saved"));
      await load();
    } catch (err) {
      failed(err);
    }
  };

  const openDetail = async (c: Customer) => {
    try {
      setDetail(await api<Detail>(`/customers/${c.id}`));
      setAdjust({ points: "", note: "" });
    } catch (e) {
      failed(e);
    }
  };

  const adjustPoints = async () => {
    if (!detail) return;
    const pts = Number(adjust.points);
    if (!Number.isInteger(pts) || pts === 0 || !adjust.note.trim()) return toast(t("common.invalidNumber"), "error");
    try {
      await api(`/customers/${detail.id}/points`, { method: "POST", json: { points: pts, note: adjust.note.trim() } });
      setDetail(await api<Detail>(`/customers/${detail.id}`));
      setAdjust({ points: "", note: "" });
      await load();
    } catch (e) {
      failed(e);
    }
  };

  const card = (label: string, value: number | undefined, id: string) => (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid={id}>
        {value === undefined ? "-" : num.format(value)}
      </div>
    </Card>
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t("customers.title")} subtitle={t("customers.subtitle")}>
        <Button variant="secondary" onClick={() => void apiDownload("/customers/export", "naqdi-customers.csv").catch(failed)}>
          <Download size={15} aria-hidden /> {t("reports.exportCsv")}
        </Button>
        {manage ? (
          <Button onClick={() => openForm("new")}>
            <Plus size={16} aria-hidden /> {t("customers.create")}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        {card(t("customers.nonMembers"), data?.summary.nonMembers, "sum-non")}
        {card(t("customers.members"), data?.summary.members, "sum-members")}
        {card(t("customers.redeemed"), data?.summary.redeemed, "sum-redeemed")}
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input type="search" placeholder={t("customers.searchHint")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select aria-label={t("customers.membership")} value={member} onChange={(e) => { setMember(e.target.value); setPage(1); }} className="max-w-44">
            <option value="">{t("customers.allCustomers")}</option>
            <option value="yes">{t("customers.members")}</option>
            <option value="no">{t("customers.nonMembers")}</option>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="customer-table">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                {["name", "phone", "memberSince", "points", "lifetimeSpending", "visits"].map((k) => (
                  <th key={k} className={`px-4 py-2.5 font-medium ${["points", "lifetimeSpending", "visits"].includes(k) ? "text-end" : "text-start"}`}>
                    {tx(`customers.cols.${k}`)}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2/60">
                  <td className="px-4 py-2.5 font-medium">
                    {c.name} {c.member ? <Badge tone="good">{t("customers.member")}</Badge> : null}
                  </td>
                  <td className="px-4 py-2.5 text-muted"><span className="ltr-text">{c.phone ?? "-"}</span></td>
                  <td className="px-4 py-2.5 text-muted">{c.memberSince ? day.format(new Date(c.memberSince)) : "-"}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{num.format(c.points)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{money(c.lifetimeSpending)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{num.format(c.visits)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => void openDetail(c)} aria-label={`${t("customers.history")} ${c.name}`} title={t("customers.history")}>
                        <History size={15} aria-hidden />
                      </Button>
                      {manage ? (
                        <>
                          <Button variant="ghost" onClick={() => void toggleMember(c)} aria-label={`${c.member ? t("customers.unenroll") : t("customers.enroll")} ${c.name}`} title={c.member ? t("customers.unenroll") : t("customers.enroll")}>
                            {c.member ? <StarOff size={15} aria-hidden /> : <Star size={15} aria-hidden />}
                          </Button>
                          <Button variant="ghost" onClick={() => openForm(c)} aria-label={`${t("common.edit")} ${c.name}`}>
                            <Pencil size={15} aria-hidden />
                          </Button>
                          <Button variant="ghost" onClick={() => setDeleting(c)} aria-label={`${t("common.delete")} ${c.name}`}>
                            <Trash2 size={15} className="text-danger" aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("common.noData")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t("customers.create") : t("customers.edit")}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" form="customer-form" disabled={busy || !form.name.trim()}>{t("common.save")}</Button>
          </>
        }
      >
        <form id="customer-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("common.name")} error={errors.name}>{(id) => <Input id={id} value={form.name} maxLength={191} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} invalid={Boolean(errors.name)} required />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.phone")} error={errors.phone}>{(id) => <Input id={id} dir="ltr" className="text-start" value={form.phone} maxLength={32} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} invalid={Boolean(errors.phone)} />}</Field>
            <Field label={t("common.email")} error={errors.email}>{(id) => <Input id={id} dir="ltr" className="text-start" value={form.email} maxLength={191} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} invalid={Boolean(errors.email)} />}</Field>
          </div>
          <Field label={t("inventory.note")}>{(id) => <Input id={id} value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />}</Field>
          {editing === "new" ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enroll} onChange={(e) => setForm((f) => ({ ...f, enroll: e.target.checked }))} />
              {t("customers.enrollNow")}
            </label>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        title={t("common.delete")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={remove} disabled={busy}>{t("common.delete")}</Button>
          </>
        }
      >
        <p>{t("common.confirmDelete")}</p>
        <p className="font-medium">{deleting?.name}</p>
      </Modal>

      <Modal open={detail !== null} title={detail?.name ?? ""} onClose={() => setDetail(null)} wide>
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-6">
              <div><div className="text-muted">{t("customers.cols.points")}</div><div className="text-2xl font-semibold tabular-nums" data-testid="detail-points">{num.format(detail.points)}</div></div>
              <div><div className="text-muted">{t("customers.cols.lifetimeSpending")}</div><div className="text-2xl font-semibold tabular-nums">{money(detail.lifetimeSpending)}</div></div>
              <div><div className="text-muted">{t("customers.cols.visits")}</div><div className="text-2xl font-semibold tabular-nums">{num.format(detail.visits)}</div></div>
            </div>
            {manage && detail.member ? (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                <Field label={t("customers.adjustPoints")} hint={t("customers.adjustHint")}>
                  {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="w-28 text-start" value={adjust.points} onChange={(e) => setAdjust((a) => ({ ...a, points: e.target.value }))} />}
                </Field>
                <Field label={t("inventory.note")}>{(id) => <Input id={id} className="min-w-48" value={adjust.note} maxLength={255} onChange={(e) => setAdjust((a) => ({ ...a, note: e.target.value }))} />}</Field>
                <Button variant="secondary" onClick={() => void adjustPoints()}>{t("common.save")}</Button>
              </div>
            ) : null}
            <table className="w-full">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="py-1.5 text-start font-medium">{t("audit.when")}</th>
                  <th className="py-1.5 text-start font-medium">{t("activities.kind")}</th>
                  <th className="py-1.5 text-end font-medium">{t("customers.cols.points")}</th>
                  <th className="py-1.5 text-end font-medium">{t("inventory.stock.balance")}</th>
                  <th className="py-1.5 text-start font-medium">{t("inventory.note")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5"><span className="ltr-text whitespace-nowrap">{when.format(new Date(l.at))}</span></td>
                    <td className="py-1.5">{tx(`customers.ledger.${l.kind}`)}</td>
                    <td className={`py-1.5 text-end tabular-nums ${l.points < 0 ? "text-danger" : ""}`}>{l.points > 0 ? "+" : ""}{num.format(l.points)}</td>
                    <td className="py-1.5 text-end tabular-nums">{num.format(l.balanceAfter)}</td>
                    <td className="py-1.5 text-muted">{l.note ?? ""}</td>
                  </tr>
                ))}
                {detail.ledger.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-muted">{t("common.noData")}</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
