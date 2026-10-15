"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { exponentOf, planLimits, type BillingInterval } from "@naqdi/domain";
import type { Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, PageHeader, Textarea, useToast } from "@/components/ui";
import { api, ApiError, type BillingView } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";

interface Invoice {
  id: string;
  number: string;
  plan: string;
  interval: BillingInterval;
  amount: number;
  currency: string;
  status: "open" | "pending" | "paid" | "void";
  custom: boolean;
  note: string | null;
  dueAt: string | null;
  paidAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  proof: { bank: string; sender: string; transferredOn: string; note: string | null; hasImage: boolean } | null;
}
interface BillingData {
  billing: BillingView | null;
  currency: string;
  plan: string;
  interval: BillingInterval | null;
  prices: { plan: "basic" | "pro"; monthly: number; yearly: number }[] | null;
  bankInfo: string | null;
  currentInvoiceId: string | null;
  invoices: Invoice[];
}

const planName = (plan: string) => (plan === "basic" ? "Starter" : plan === "pro" ? "Pro" : plan === "unlimited" ? "Enterprise" : plan);
const today = () => new Date().toISOString().slice(0, 10);
const emptyProof = { bank: "", sender: "", transferredOn: today(), note: "" };

export default function SubscriptionPage() {
  const t = useTranslations("subscription");
  const tc = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can } = useAuth();
  const [data, setData] = useState<BillingData | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [proof, setProof] = useState(emptyProof);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit" }), [locale]);
  const day = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "-");

  const load = useCallback(async () => {
    try {
      setData(await api<BillingData>("/billing"));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tc("errors.network"), "error");
    }
  }, [toast, tc]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!can("settings.manage")) return <p className="text-muted">{tc("errors.forbidden")}</p>;
  if (!data) return <p className="text-muted">{tc("common.loading")}</p>;

  const money = (minor: number, currency: string) => formatMinor(minor, exponentOf(currency), currency, locale);
  const current = data.invoices.find((i) => i.id === data.currentInvoiceId) ?? null;
  const b = data.billing;

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.fields) setErrors(e.fields);
    toast(e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : tc("errors.network"), "error");
  };

  const choose = async (plan: "basic" | "pro") => {
    setBusy(true);
    setErrors({});
    try {
      await api("/billing/invoices", { method: "POST", json: { plan, interval } });
      setProof(emptyProof);
      setFile(null);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const voidInvoice = async (id: string) => {
    setBusy(true);
    try {
      await api(`/billing/invoices/${id}/void`, { method: "POST", json: {} });
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const submitProof = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    setErrors({});
    const form = new FormData();
    for (const [k, v] of Object.entries(proof)) form.set(k, v);
    if (file) form.set("file", file);
    try {
      await api(`/billing/invoices/${current.id}/proof`, { method: "POST", body: form });
      toast(t("proofSent"));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const limits = (plan: string) => (plan in planLimits ? planLimits[plan as keyof typeof planLimits] : null);
  const fmtLimit = (n: number) => (n >= Number.MAX_SAFE_INTEGER ? "∞" : String(n));
  const statusTone = (s: Invoice["status"]) => (s === "paid" ? "good" : s === "pending" ? "warn" : s === "void" ? "neutral" : "bad");

  return (
    <div className="space-y-5" data-testid="subscription-page">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="grid gap-4 p-5 sm:grid-cols-4" data-testid="sub-status">
        <div>
          <div className="text-sm text-muted">{t("currentPlan")}</div>
          <div className="text-lg font-semibold">{planName(data.plan)}</div>
        </div>
        <div>
          <div className="text-sm text-muted">{t("statusLabel")}</div>
          <div className="text-lg font-semibold">{b ? tc(`platformUi.status.${b.status}` as never) : "-"}</div>
        </div>
        <div>
          <div className="text-sm text-muted">{b?.status === "trial" ? t("trialEnds") : t("periodEnds")}</div>
          <div className="text-lg font-semibold" dir="ltr">{day(b?.status === "trial" ? b.trialEndsAt : b?.currentPeriodEndsAt)}</div>
        </div>
        <div>
          <div className="text-sm text-muted">{t("cycle")}</div>
          <div className="text-lg font-semibold">{data.interval ? t(`interval.${data.interval}` as never) : "-"}</div>
        </div>
      </Card>

      {current ? (
        <Card className="space-y-4 p-5" data-testid="sub-invoice">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {t("invoice")} <span dir="ltr" data-testid="inv-number">{current.number}</span>
            </h2>
            <Badge tone={statusTone(current.status)}>{t(`status.${current.status}` as never)}</Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">{t("planAndCycle")}</dt><dd className="font-medium">{planName(current.plan)} · {t(`interval.${current.interval}` as never)}</dd></div>
            <div><dt className="text-muted">{t("amount")}</dt><dd className="text-lg font-semibold" dir="ltr" data-testid="inv-amount">{money(current.amount, current.currency)}</dd></div>
            <div><dt className="text-muted">{t("dueAt")}</dt><dd className="font-medium" dir="ltr">{day(current.dueAt)}</dd></div>
            {current.note ? <div><dt className="text-muted">{t("note")}</dt><dd className="font-medium">{current.note}</dd></div> : null}
          </dl>

          {current.status === "open" ? (
            <>
              <div className="rounded-lg bg-surface-2 p-4 text-sm" data-testid="inv-bank">
                <div className="mb-1 font-medium">{t("howToPay")}</div>
                {data.bankInfo ? <p className="whitespace-pre-line" dir="auto">{data.bankInfo}</p> : <p className="text-muted">{t("noBankInfo")}</p>}
                <p className="mt-2 text-muted">{t("payExact", { amount: money(current.amount, current.currency) })}</p>
              </div>
              {current.rejectReason ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger" data-testid="inv-rejected">{t("rejected", { reason: current.rejectReason })}</p> : null}

              <form onSubmit={submitProof} className="grid gap-4 sm:grid-cols-2" noValidate data-testid="proof-form">
                <h3 className="font-medium sm:col-span-2">{t("sendProof")}</h3>
                <Field label={t("bank")} error={errors.bank}>{(id) => <Input id={id} value={proof.bank} maxLength={80} onChange={(e) => setProof({ ...proof, bank: e.target.value })} invalid={Boolean(errors.bank)} data-testid="proof-bank" />}</Field>
                <Field label={t("sender")} error={errors.sender}>{(id) => <Input id={id} value={proof.sender} maxLength={120} onChange={(e) => setProof({ ...proof, sender: e.target.value })} invalid={Boolean(errors.sender)} data-testid="proof-sender" />}</Field>
                <Field label={t("transferredOn")} error={errors.transferredOn}>{(id) => <Input id={id} type="date" dir="ltr" className="text-start" value={proof.transferredOn} max={today()} onChange={(e) => setProof({ ...proof, transferredOn: e.target.value })} invalid={Boolean(errors.transferredOn)} data-testid="proof-date" />}</Field>
                <Field label={t("file")} hint={t("fileHint")} error={errors.file}>{(id) => <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="proof-file" className="block w-full text-sm" />}</Field>
                <div className="sm:col-span-2">
                  <Field label={t("note")} error={errors.note}>{(id) => <Textarea id={id} rows={2} maxLength={255} value={proof.note} onChange={(e) => setProof({ ...proof, note: e.target.value })} />}</Field>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={busy} data-testid="proof-submit">{t("submitProof")}</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => void voidInvoice(current.id)} data-testid="inv-void">{t("cancelInvoice")}</Button>
                </div>
              </form>
            </>
          ) : null}

          {current.status === "pending" ? (
            <div className="rounded-lg bg-brand-soft p-4 text-sm" data-testid="inv-pending">
              <p className="font-medium">{t("pendingTitle")}</p>
              <p className="text-muted">{t("pendingBody")}</p>
              {current.proof ? <p className="mt-2" dir="auto">{current.proof.bank} · {current.proof.sender} · <span dir="ltr">{current.proof.transferredOn}</span></p> : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {!current || current.status === "open" ? (
        <Card className="space-y-4 p-5" data-testid="sub-plans">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("choosePlan")}</h2>
            {data.prices ? (
              <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label={t("cycle")}>
                {(["monthly", "yearly"] as const).map((i) => (
                  <button key={i} type="button" onClick={() => setInterval(i)} aria-pressed={interval === i} data-testid={`interval-${i}`} className={`rounded-md px-3 py-1 text-sm font-medium ${interval === i ? "bg-brand text-white" : "text-muted"}`}>
                    {t(`interval.${i}` as never)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {data.prices ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {data.prices.map((p) => {
                  const l = limits(p.plan)!;
                  return (
                    <div key={p.plan} className="space-y-2 rounded-lg border border-line p-4" data-testid={`plan-${p.plan}`}>
                      <div className="flex items-center justify-between">
                        <div className="text-lg font-semibold">{planName(p.plan)}</div>
                        {data.plan === p.plan && data.interval === interval ? <Badge tone="good">{t("yourPlan")}</Badge> : null}
                      </div>
                      <div className="text-2xl font-bold" dir="ltr">{money(p[interval], data.currency)}<span className="text-sm font-normal text-muted"> / {t(`per.${interval}` as never)}</span></div>
                      <ul className="space-y-0.5 text-sm text-muted">
                        <li>{t("limitOutlets", { n: fmtLimit(l.maxOutlets) })}</li>
                        <li>{t("limitDevices", { n: fmtLimit(l.maxDevices) })}</li>
                        <li>{t("limitEmployees", { n: fmtLimit(l.maxEmployees) })}</li>
                      </ul>
                      <Button className="w-full" disabled={busy} onClick={() => void choose(p.plan)} data-testid={`choose-${p.plan}`}>{t("createInvoice")}</Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-sm text-muted">{t("yearlyNote")} {t("enterprise")}</p>
            </>
          ) : (
            <p className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="no-prices">{t("noPrices", { currency: data.currency })}</p>
          )}
        </Card>
      ) : null}

      <Card className="overflow-x-auto" data-testid="sub-history">
        <h2 className="p-5 pb-2 text-lg font-semibold">{t("history")}</h2>
        {data.invoices.length === 0 ? <p className="p-5 pt-0 text-sm text-muted">{t("noInvoices")}</p> : null}
        {data.invoices.length ? (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>{["number", "planAndCycle", "amount", "statusLabel", "date"].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`col.${k}` as never)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.invoices.map((i) => (
                <tr key={i.id} data-testid="inv-row">
                  <td className="px-3 py-2" dir="ltr">{i.number}</td>
                  <td className="px-3 py-2">{planName(i.plan)} · {t(`interval.${i.interval}` as never)}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{money(i.amount, i.currency)}</td>
                  <td className="px-3 py-2"><Badge tone={statusTone(i.status)}>{t(`status.${i.status}` as never)}</Badge></td>
                  <td className="px-3 py-2" dir="ltr">{day(i.paidAt ?? i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
