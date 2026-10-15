"use client";

import { useLocale, useTranslations } from "next-intl";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { fmtLimit, levelTone, type BizRow } from "@/components/platform/shared";
import { Link } from "@/i18n/navigation";
import { PlatformError, platformApi, usePlatformSession } from "@/lib/platformApi";

interface InvoiceItem {
  id: string;
  number: string;
  plan: string;
  interval: string;
  amount: number;
  currency: string;
  status: string;
}

interface HistoryItem {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  at: string;
  admin: string | null;
}

const toLocalDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export default function PlatformBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("platformUi");
  const locale = useLocale();
  const toast = useToast();
  const { admin } = usePlatformSession();
  const canWrite = admin?.role === "owner";
  const [b, setB] = useState<BizRow | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [extend, setExtend] = useState("14");
  const [plan, setPlan] = useState("basic");
  const [limits, setLimits] = useState({ maxOutlets: "", maxDevices: "", maxEmployees: "" });
  const [interval, setInterval] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [status, setStatus] = useState("trial");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [invPlan, setInvPlan] = useState("basic");
  const [invInterval, setInvInterval] = useState("monthly");
  const [invAmount, setInvAmount] = useState("");

  const when = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);

  const apply = useCallback((row: BizRow) => {
    setB(row);
    setPlan(row.plan);
    setStatus(row.status);
    setInterval(row.billingInterval ?? "");
    setPeriodEnd(toLocalDate(row.currentPeriodEndsAt));
    setLimits({ maxOutlets: String(row.limitsOverride?.maxOutlets ?? ""), maxDevices: String(row.limitsOverride?.maxDevices ?? ""), maxEmployees: String(row.limitsOverride?.maxEmployees ?? "") });
    setReason("");
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await platformApi<{ business: BizRow; history: HistoryItem[] }>(`/businesses/${id}`);
      apply(r.business);
      setHistory(r.history);
      const inv = await platformApi<{ items: InvoiceItem[] }>(`/invoices?businessId=${id}&pageSize=10`);
      setInvoices(inv.items);
      setError("");
    } catch (e) {
      setError(e instanceof PlatformError ? e.message : t("network"));
    }
  }, [id, apply, t]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Kirim satu perubahan. `note` selalu ikut agar masuk jejak audit. */
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await platformApi(`/businesses/${id}`, { method: "PATCH", json: { ...body, ...(note ? { note } : {}) } });
      toast(t("saved"));
      setNote("");
      await load();
    } catch (e) {
      if (e instanceof PlatformError && e.fields) setErrors(e.fields);
      else toast(e instanceof PlatformError ? e.message : t("network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const createInvoice = async () => {
    setBusy(true);
    setErrors({});
    try {
      const amount = invAmount.trim() === "" ? undefined : Number(invAmount);
      const r = await platformApi<{ invoice: { number: string } }>(`/businesses/${id}/invoices`, { method: "POST", json: { plan: invPlan, interval: invInterval, ...(amount !== undefined ? { amount } : {}), ...(note ? { note } : {}) } });
      toast(t("invoiceCreated", { number: r.invoice.number }));
      setInvAmount("");
      setNote("");
      await load();
    } catch (e) {
      if (e instanceof PlatformError && e.fields) setErrors(e.fields);
      toast(e instanceof PlatformError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : t("network"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!b) return <p className="text-muted">{t("loading")}</p>;
  const day = (iso: string | null | undefined) => (iso ? when.format(new Date(iso)) : "-");
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const limitsBody = () => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(limits)) {
      const n = num(v);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  };

  return (
    <div className="space-y-5" data-testid="biz-detail">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/platform/businesses" className="text-sm text-brand underline">{t("navBusinesses")}</Link>
        <h1 className="text-xl font-semibold">{b.name}</h1>
        <Badge tone={levelTone(b.access.level)}>{t(`status.${b.status}` as never)}</Badge>
        <Badge tone="neutral">{t(`level.${b.access.level}` as never)}</Badge>
      </div>
      {!canWrite ? <p className="rounded-lg bg-warn-soft p-3 text-sm">{t("readOnly")}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-2 p-4 text-sm lg:col-span-2" data-testid="biz-info">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              [t("col.owner"), b.owner ? `${b.owner.name} · ${b.owner.email}` : "-"],
              [t("f.country"), `${b.country ?? "-"} · ${b.currency}`],
              [t("f.plan"), b.plan],
              [t("trialEnds"), day(b.trialEndsAt)],
              [t("periodEnds"), `${day(b.currentPeriodEndsAt)}${b.billingInterval ? ` (${t(`interval.${b.billingInterval}` as never)})` : ""}`],
              [t("createdAt"), day(b.createdAt)],
              [t("terms"), b.termsAcceptedAt ? `${day(b.termsAcceptedAt)} · ${b.termsVersion ?? ""}` : "-"],
              [t("lastOrder"), day(b.lastOrderAt)],
              [t("col.orders30"), String(b.orders30d ?? 0)],
              [t("suspendInfo"), b.suspendedAt ? `${day(b.suspendedAt)}: ${b.suspendReason ?? ""}` : "-"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium" dir="auto">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="space-y-2 p-4 text-sm" data-testid="biz-usage">
          <div className="font-medium">{t("usage")}</div>
          {[
            [t("u.outlets"), b.usage?.outlets ?? 0, b.limits.maxOutlets],
            [t("u.devices"), b.usage?.devices ?? 0, b.limits.maxDevices],
            [t("u.employees"), b.usage?.employees ?? 0, b.limits.maxEmployees],
          ].map(([k, used, max]) => (
            <div key={String(k)} className="flex items-center justify-between gap-3">
              <span className="text-muted">{k}</span>
              <span className={`tabular-nums ${Number(used) > Number(max) ? "font-semibold text-danger" : ""}`} dir="ltr">{String(used)} / {fmtLimit(Number(max))}</span>
            </div>
          ))}
          {b.limitsOverride ? <p className="text-xs text-muted">{t("customLimits")}</p> : null}
        </Card>
      </div>

      {canWrite ? (
        <Card className="space-y-5 p-4" data-testid="biz-actions">
          <Field label={t("note")} hint={t("noteHint")}>{(i) => <Input id={i} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="a-note" />}</Field>

          <div className="grid gap-5 md:grid-cols-2">
            <section className="space-y-2">
              <h2 className="font-medium">{t("a.trial")}</h2>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("a.extendDays")} error={errors.extendTrialDays}>{(i) => <Input id={i} inputMode="numeric" dir="ltr" className="w-24 text-start" value={extend} onChange={(e) => setExtend(e.target.value)} data-testid="a-extend" />}</Field>
                <Button variant="secondary" disabled={busy} onClick={() => void patch({ extendTrialDays: Number(extend) })} data-testid="a-extend-go">{t("a.extend")}</Button>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">{t("a.status")}</h2>
              <div className="flex flex-wrap items-end gap-2">
                <Select aria-label={t("a.status")} value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" data-testid="a-status">
                  {["trial", "active", "past_due", "suspended", "cancelled"].map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
                </Select>
                {status === "suspended" ? (
                  <Field label={t("a.reason")} error={errors.suspendReason}>{(i) => <Input id={i} className="w-64" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} data-testid="a-reason" />}</Field>
                ) : null}
                <Button variant={status === "suspended" ? "danger" : "secondary"} disabled={busy || status === b.status} onClick={() => void patch({ status, ...(status === "suspended" ? { suspendReason: reason } : {}) })} data-testid="a-status-go">{t("a.apply")}</Button>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">{t("a.plan")}</h2>
              <div className="flex flex-wrap items-end gap-2">
                <Select aria-label={t("a.plan")} value={plan} onChange={(e) => setPlan(e.target.value)} className="w-40" data-testid="a-plan">
                  {["basic", "pro", "unlimited"].map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
                <Button variant="secondary" disabled={busy || plan === b.plan} onClick={() => void patch({ plan })} data-testid="a-plan-go">{t("a.apply")}</Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {(["maxOutlets", "maxDevices", "maxEmployees"] as const).map((k) => (
                  <Field key={k} label={t(`a.${k}` as never)} error={errors[`limits.${k}`]}>{(i) => <Input id={i} inputMode="numeric" dir="ltr" className="w-24 text-start" value={limits[k]} placeholder="-" onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))} data-testid={`a-${k}`} />}</Field>
                ))}
                <Button variant="secondary" disabled={busy} onClick={() => void patch({ limits: limitsBody() })} data-testid="a-limits-go">{t("a.applyLimits")}</Button>
              </div>
              <p className="text-xs text-muted">{t("a.limitsHint")}</p>
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">{t("a.subscription")}</h2>
              <div className="flex flex-wrap items-end gap-2">
                <Select aria-label={t("a.interval")} value={interval} onChange={(e) => setInterval(e.target.value)} className="w-36" data-testid="a-interval">
                  <option value="">-</option>
                  <option value="monthly">{t("interval.monthly")}</option>
                  <option value="yearly">{t("interval.yearly")}</option>
                </Select>
                <Field label={t("periodEnds")} error={errors.currentPeriodEndsAt}>{(i) => <Input id={i} type="date" dir="ltr" className="w-44 text-start" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} data-testid="a-period" />}</Field>
                <Button variant="secondary" disabled={busy} onClick={() => void patch({ billingInterval: interval || null, currentPeriodEndsAt: periodEnd ? new Date(`${periodEnd}T23:59:59Z`).toISOString() : null })} data-testid="a-sub-go">{t("a.apply")}</Button>
              </div>
            </section>
          </div>
        </Card>
      ) : null}

      <Card className="space-y-3 p-4" data-testid="biz-invoices">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{t("invoices")}</h2>
          <Link href="/platform/invoices" className="text-sm text-brand underline">{t("viewAll")}</Link>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label={t("a.plan")} value={invPlan} onChange={(e) => setInvPlan(e.target.value)} className="w-40" data-testid="inv-plan">
              {["basic", "pro", "unlimited"].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Select aria-label={t("invInterval")} value={invInterval} onChange={(e) => setInvInterval(e.target.value)} className="w-36" data-testid="inv-interval">
              <option value="monthly">{t("interval.monthly")}</option>
              <option value="yearly">{t("interval.yearly")}</option>
            </Select>
            <Field label={t("invAmount")} error={errors.amount}>{(i) => <Input id={i} inputMode="numeric" dir="ltr" className="w-56 text-start" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} data-testid="inv-amount" />}</Field>
            <Button variant="secondary" disabled={busy} onClick={() => void createInvoice()} data-testid="inv-create">{t("newInvoice")}</Button>
          </div>
        ) : null}
        {invoices.length === 0 ? <p className="text-sm text-muted">{t("none")}</p> : null}
        <ul className="divide-y divide-line text-sm">
          {invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5" data-testid="biz-invoice-row">
              <span dir="ltr">{i.number}</span>
              <span>{i.plan} · {i.interval}</span>
              <span className="tabular-nums" dir="ltr">{i.amount} {i.currency}</span>
              <span>{t(`invStatus.${i.status}` as never)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4" data-testid="biz-history">
        <h2 className="mb-2 font-medium">{t("history")}</h2>
        {history.length === 0 ? <p className="text-sm text-muted">{t("none")}</p> : null}
        <ul className="divide-y divide-line text-sm">
          {history.map((h) => (
            <li key={h.id} className="space-y-1 py-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{t(`action.${h.action}` as never)}</span>
                <span className="text-muted">{h.admin ?? t("system")} · <span dir="ltr">{when.format(new Date(h.at))}</span></span>
              </div>
              {h.detail ? <pre dir="ltr" className="overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-start text-xs">{JSON.stringify(h.detail, null, 2)}</pre> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
