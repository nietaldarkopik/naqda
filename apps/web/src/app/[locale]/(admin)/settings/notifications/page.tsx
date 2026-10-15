"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, PageHeader, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";

export default function NotificationSettingsPage() {
  const t = useTranslations();
  const toast = useToast();
  const { can } = useAuth();
  const { data, save } = useSettings();
  const [form, setForm] = useState({ dailySummary: false, lowStock: false, recipients: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm({ dailySummary: data.notifications.dailySummary, lowStock: data.notifications.lowStock, recipients: data.notifications.recipients.join("\n") });
  }, [data]);

  if (!can("settings.manage")) return <p className="text-muted">{t("errors.forbidden")}</p>;

  const recipients = () => form.recipients.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const r = await save("notifications", { dailySummary: form.dailySummary, lowStock: form.lowStock, recipients: recipients() });
    setBusy(false);
    if (r.ok) toast(t("common.saved"));
    else {
      setErrors({ recipients: Object.values(r.fields)[0] ?? r.message });
      toast(r.message, "error");
    }
  };

  const sendTest = async () => {
    try {
      const res = await api<{ subject: string; body: string }>("/settings/notifications/test", { method: "POST", json: {} });
      setPreview(res);
    } catch (e) {
      toast(e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : t("errors.network"), "error");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.notifications.title")} subtitle={t("settings.notifications.subtitle")} />
      <Card className="space-y-4 p-5">
        <p className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="email-notice">{t("settings.notifications.notice")}</p>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.dailySummary} onChange={(e) => setForm({ ...form, dailySummary: e.target.checked })} data-testid="notif-daily" />
          <span><span className="block font-medium">{t("settings.notifications.daily")}</span><span className="block text-sm text-muted">{t("settings.notifications.dailyHint")}</span></span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.lowStock} onChange={(e) => setForm({ ...form, lowStock: e.target.checked })} />
          <span><span className="block font-medium">{t("settings.notifications.lowStock")}</span><span className="block text-sm text-muted">{t("settings.notifications.lowStockHint")}</span></span>
        </label>
        <Field label={t("settings.notifications.recipients")} hint={t("settings.notifications.recipientsHint")} error={errors.recipients}>
          {(id) => <textarea id={id} rows={3} dir="ltr" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-start text-sm" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} data-testid="notif-recipients" />}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void sendTest()} disabled={recipients().length === 0} data-testid="notif-test">{t("settings.notifications.test")}</Button>
          <Button disabled={busy} onClick={() => void submit()} data-testid="notif-save">{t("common.save")}</Button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-line p-3" data-testid="notif-preview">
            <div className="font-medium">{preview.subject}</div>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-muted" dir="ltr">{preview.body}</pre>
            <p className="mt-2 text-xs text-muted">{t("settings.notifications.loggedOnly")}</p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
