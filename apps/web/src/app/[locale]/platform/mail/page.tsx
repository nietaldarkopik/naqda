"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Card, Field, Input, Pager, Select, useToast } from "@/components/ui";
import { PlatformError, platformApi, usePlatformSession } from "@/lib/platformApi";

interface MailStatus {
  driver: string;
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  replyTo: string | null;
  operatorEmail: string | null;
  appUrl: string;
  counts: Record<string, number>;
}
interface MailRow {
  id: string;
  to: string;
  kind: string;
  subject: string;
  status: "queued" | "sending" | "sent" | "logged" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

const tone = (s: MailRow["status"]) => (s === "sent" ? "good" : s === "failed" ? "bad" : s === "logged" ? "neutral" : "warn");

export default function PlatformMailPage() {
  const t = useTranslations("platformUi");
  const locale = useLocale();
  const toast = useToast();
  const { admin } = usePlatformSession();
  const canWrite = admin?.role === "owner";
  const [st, setSt] = useState<MailStatus | null>(null);
  const [rows, setRows] = useState<MailRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ verify: { ok: boolean; error?: string }; mail: { status: string; lastError: string | null } } | null>(null);
  const [error, setError] = useState("");
  const pageSize = 25;

  const when = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(filter ? { status: filter } : {}) });
    try {
      const [s, l] = await Promise.all([platformApi<MailStatus>("/mail/status"), platformApi<{ items: MailRow[]; total: number }>(`/mail?${qs}`)]);
      setSt(s);
      setRows(l.items);
      setTotal(l.total);
      setError("");
    } catch (e) {
      setError(e instanceof PlatformError ? e.message : t("network"));
    }
  }, [page, filter, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const sendTest = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      setResult(await platformApi(`/mail/test`, { method: "POST", json: { to } }));
      await load();
    } catch (err) {
      toast(err instanceof PlatformError ? (err.fields ? Object.values(err.fields)[0]! : err.message) : t("network"), "error");
    } finally {
      setBusy(false);
    }
  };
  const retry = async (id: string) => {
    try {
      await platformApi(`/mail/${id}/retry`, { method: "POST", json: {} });
      await load();
    } catch (err) {
      toast(err instanceof PlatformError ? err.message : t("network"), "error");
    }
  };

  const info: [string, string][] = st
    ? [
        [t("mail.driver"), st.configured ? "SMTP" : t("mail.logOnly")],
        [t("mail.host"), st.host ? `${st.host}:${st.port} (${st.secure ? "TLS" : "STARTTLS"})` : "-"],
        [t("mail.user"), st.user ?? "-"],
        [t("mail.from"), st.from],
        [t("mail.operator"), st.operatorEmail ?? "-"],
        [t("mail.appUrl"), st.appUrl],
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="mail-page">
      <h1 className="text-xl font-semibold">{t("navMail")}</h1>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}

      {st ? (
        <Card className="space-y-3 p-4" data-testid="mail-status">
          {!st.configured ? <p className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="mail-log-only">{t("mail.logOnlyNote")}</p> : null}
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {info.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium" dir="ltr">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2 text-sm">
            {Object.entries(st.counts).map(([k, v]) => <Badge key={k} tone={tone(k as MailRow["status"])}>{t(`mail.status.${k}` as never)}: {v}</Badge>)}
          </div>
        </Card>
      ) : null}

      {canWrite ? (
        <Card className="p-4">
          <form onSubmit={sendTest} className="flex flex-wrap items-end gap-2" noValidate>
            <Field label={t("mail.testTo")}>{(id) => <Input id={id} type="email" dir="ltr" className="w-72 text-start" value={to} onChange={(e) => setTo(e.target.value)} data-testid="mail-test-to" />}</Field>
            <Button type="submit" disabled={busy || !to} data-testid="mail-test-go">{t("mail.sendTest")}</Button>
          </form>
          {result ? (
            <div className="mt-3 space-y-1 text-sm" data-testid="mail-test-result" role="status">
              <p>{t("mail.connection")}: {result.verify.ok ? <Badge tone="good">OK</Badge> : <Badge tone="bad">{result.verify.error}</Badge>}</p>
              <p>{t("mail.delivery")}: <Badge tone={tone(result.mail.status as MailRow["status"])}>{t(`mail.status.${result.mail.status}` as never)}</Badge> {result.mail.lastError ? <span className="text-danger">{result.mail.lastError}</span> : null}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <span className="text-sm text-muted tabular-nums">{total}</span>
          <Select className="w-48" aria-label={t("inv.status")} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} data-testid="mail-filter">
            <option value="">{t("invoiceStatusAll")}</option>
            {["queued", "sent", "logged", "failed"].map((s) => <option key={s} value={s}>{t(`mail.status.${s}` as never)}</option>)}
          </Select>
        </div>
        <table className="w-full text-sm" data-testid="mail-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>{["when", "to", "kind", "subject", "status"].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`mail.col.${k}` as never)}</th>)}<th /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows === null ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">{t("loading")}</td></tr> : null}
            {rows?.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">{t("none")}</td></tr> : null}
            {rows?.map((r) => (
              <tr key={r.id} data-testid="mail-row">
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{when.format(new Date(r.createdAt))}</td>
                <td className="px-3 py-2" dir="ltr">{r.to}</td>
                <td className="px-3 py-2">{r.kind}</td>
                <td className="px-3 py-2" dir="auto">{r.subject}</td>
                <td className="px-3 py-2">
                  <Badge tone={tone(r.status)}>{t(`mail.status.${r.status}` as never)}</Badge>
                  {r.lastError ? <div className="mt-0.5 max-w-xs truncate text-xs text-danger" title={r.lastError}>{r.lastError}</div> : null}
                </td>
                <td className="px-3 py-2">{canWrite && r.status === "failed" ? <Button variant="secondary" onClick={() => void retry(r.id)} data-testid="mail-retry">{t("mail.retry")}</Button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows ? <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} /> : null}
      </Card>
    </div>
  );
}
