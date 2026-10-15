"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { countries, supportedCurrencies } from "@naqdi/domain";
import { Badge, Button, Card, Field, Input, Modal, Pager, Select } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { fmtLimit, levelTone, type BizRow } from "@/components/platform/shared";
import { PlatformError, platformApi, usePlatformSession } from "@/lib/platformApi";

const emptyForm = { name: "", currency: "IDR", timezone: "Asia/Jakarta", locale: "id", country: "ID", plan: "basic", mode: "trial", trialDays: "14", adminEmail: "", adminName: "", adminPassword: "" };

export default function PlatformBusinessesPage() {
  const t = useTranslations("platformUi");
  const locale = useLocale();
  const { admin } = usePlatformSession();
  const [rows, setRows] = useState<BizRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [expiring, setExpiring] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; password?: string } | null>(null);
  const [error, setError] = useState("");
  const pageSize = 25;

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit" }), [locale]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) qs.set("q", query);
    if (status) qs.set("status", status);
    if (expiring) qs.set("expiringDays", "3");
    try {
      const r = await platformApi<{ items: BizRow[]; total: number }>(`/businesses?${qs}`);
      setRows(r.items);
      setTotal(r.total);
      setError("");
    } catch (e) {
      setError(e instanceof PlatformError ? e.message : t("network"));
    }
  }, [page, query, status, expiring, t]);
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

  const pickCountry = (code: string) => {
    const c = countries.find((x) => x.code === code);
    setForm((f) => ({ ...f, country: code, ...(c ? { currency: c.currency, timezone: c.timezone, locale: c.locale } : {}) }));
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await platformApi<{ business: BizRow; admin: { email: string; password?: string } }>("/businesses", {
        method: "POST",
        json: {
          name: form.name,
          currency: form.currency,
          timezone: form.timezone,
          locale: form.locale,
          ...(form.country ? { country: form.country } : {}),
          plan: form.plan,
          mode: form.mode,
          trialDays: Number(form.trialDays) || 14,
          adminEmail: form.adminEmail,
          ...(form.adminName ? { adminName: form.adminName } : {}),
          ...(form.adminPassword ? { adminPassword: form.adminPassword } : {}),
        },
      });
      setCreating(false);
      setCreated({ name: r.business.name, email: r.admin.email, ...(r.admin.password ? { password: r.admin.password } : {}) });
      setForm(emptyForm);
      await load();
    } catch (err) {
      if (err instanceof PlatformError && err.fields) setErrors(err.fields);
      else setError(err instanceof PlatformError ? err.message : t("network"));
    } finally {
      setBusy(false);
    }
  };

  const canWrite = admin?.role === "owner";
  const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "-");
  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("navBusinesses")} <span className="text-base font-normal text-muted tabular-nums" data-testid="biz-total">({total})</span></h1>
        {canWrite ? (
          <Button onClick={() => setCreating(true)} data-testid="biz-create">
            {t("createBusiness")}
          </Button>
        ) : null}
      </div>

      {created ? (
        <div role="status" className="space-y-1 rounded-lg bg-brand-soft p-4 text-sm" data-testid="biz-created">
          <div className="font-medium">{t("createdTitle", { name: created.name })}</div>
          <div dir="ltr" className="text-start">{created.email}</div>
          {created.password ? (
            <div>
              {t("passwordOnce")}: <code dir="ltr" className="select-all rounded bg-surface px-1.5 py-0.5 font-mono" data-testid="biz-created-password">{created.password}</code>
            </div>
          ) : null}
          <Button variant="ghost" onClick={() => setCreated(null)}>{t("close")}</Button>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-64" type="search" placeholder={t("searchBusiness")} aria-label={t("searchBusiness")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="biz-search" />
          <Select className="max-w-48" aria-label={t("filterStatus")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="biz-status">
            <option value="">{t("allStatuses")}</option>
            {["trial", "active", "past_due", "suspended", "cancelled"].map((s) => (
              <option key={s} value={s}>{t(`status.${s}` as never)}</option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={expiring} onChange={(e) => { setExpiring(e.target.checked); setPage(1); }} data-testid="biz-expiring" />
            {t("expiringOnly")}
          </label>
        </div>
        {error ? <p role="alert" className="p-3 text-sm text-danger">{error}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="biz-table">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                {["business", "owner", "status", "plan", "usage", "orders30", "ends"].map((k) => (
                  <th key={k} className="px-3 py-2 text-start font-medium">{t(`col.${k}` as never)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows === null ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">{t("loading")}</td></tr> : null}
              {rows?.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">{t("none")}</td></tr> : null}
              {rows?.map((b) => (
                <tr key={b.id} data-testid="biz-row">
                  <td className="px-3 py-2">
                    <Link href={`/platform/businesses/${b.id}`} className="font-medium text-brand underline">{b.name}</Link>
                    <div className="text-xs text-muted">{b.country ?? "-"} · {b.currency}</div>
                  </td>
                  <td className="px-3 py-2"><span dir="ltr" className="block text-start">{b.owner?.email ?? "-"}</span></td>
                  <td className="px-3 py-2">
                    <Badge tone={levelTone(b.access.level)}>{t(`status.${b.status}` as never)}</Badge>
                    {b.access.level !== "full" ? <div className="mt-0.5 text-xs text-muted">{t(`level.${b.access.level}` as never)}</div> : null}
                  </td>
                  <td className="px-3 py-2">{b.plan}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {b.usage ? `${b.usage.outlets}/${fmtLimit(b.limits.maxOutlets)} · ${b.usage.devices}/${fmtLimit(b.limits.maxDevices)} · ${b.usage.employees}/${fmtLimit(b.limits.maxEmployees)}` : "-"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{b.orders30d ?? 0}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{day(b.status === "trial" ? b.trialEndsAt : b.currentPeriodEndsAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows ? <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={creating}
        title={t("createBusiness")}
        onClose={() => setCreating(false)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>{t("cancel")}</Button>
            <Button type="submit" form="biz-form" disabled={busy || !form.name || !form.adminEmail} data-testid="biz-save">{t("create")}</Button>
          </>
        }
      >
        <form id="biz-form" onSubmit={create} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label={t("f.name")} error={errors.name}>{(id) => <Input id={id} value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} invalid={Boolean(errors.name)} data-testid="f-name" />}</Field>
          <Field label={t("f.adminEmail")} error={errors.adminEmail}>{(id) => <Input id={id} type="email" dir="ltr" className="text-start" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} invalid={Boolean(errors.adminEmail)} data-testid="f-email" />}</Field>
          <Field label={t("f.country")}>
            {(id) => (
              <Select id={id} value={form.country} onChange={(e) => pickCountry(e.target.value)}>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t("f.currency")} error={errors.currency}>
            {(id) => (
              <Select id={id} value={form.currency} onChange={(e) => set("currency", e.target.value)} data-testid="f-currency">
                {supportedCurrencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t("f.timezone")} error={errors.timezone}>{(id) => <Input id={id} dir="ltr" className="text-start" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} invalid={Boolean(errors.timezone)} />}</Field>
          <Field label={t("f.plan")}>
            {(id) => (
              <Select id={id} value={form.plan} onChange={(e) => set("plan", e.target.value)} data-testid="f-plan">
                {["basic", "pro", "unlimited"].map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t("f.mode")}>
            {(id) => (
              <Select id={id} value={form.mode} onChange={(e) => set("mode", e.target.value)} data-testid="f-mode">
                <option value="trial">{t("f.modeTrial")}</option>
                <option value="active">{t("f.modeActive")}</option>
              </Select>
            )}
          </Field>
          {form.mode === "trial" ? <Field label={t("f.trialDays")}>{(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={form.trialDays} onChange={(e) => set("trialDays", e.target.value)} />}</Field> : <div />}
          <Field label={t("f.adminName")}>{(id) => <Input id={id} value={form.adminName} onChange={(e) => set("adminName", e.target.value)} />}</Field>
          <Field label={t("f.adminPassword")} hint={t("f.adminPasswordHint")} error={errors.adminPassword}>{(id) => <Input id={id} type="password" dir="ltr" className="text-start" value={form.adminPassword} onChange={(e) => set("adminPassword", e.target.value)} autoComplete="new-password" />}</Field>
        </form>
      </Modal>
    </div>
  );
}
