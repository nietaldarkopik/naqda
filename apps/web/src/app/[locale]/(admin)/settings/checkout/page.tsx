"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Card, PageHeader, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useSettings, type AllSettings } from "@/lib/settings";

export default function CheckoutSettingsPage() {
  const t = useTranslations();
  const toast = useToast();
  const { can } = useAuth();
  const { data, save } = useSettings();
  const [form, setForm] = useState<AllSettings["checkout"] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(data.checkout);
  }, [data]);

  if (!can("settings.manage")) return <p className="text-muted">{t("errors.forbidden")}</p>;

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    const r = await save("checkout", form);
    setBusy(false);
    toast(r.ok ? t("common.saved") : r.message, r.ok ? "ok" : "error");
  };

  const toggles: { key: keyof AllSettings["checkout"]; label: string; hint: string }[] = [
    { key: "taxEnabled", label: t("settings.checkout.tax"), hint: t("settings.checkout.taxHint") },
    { key: "gratuityEnabled", label: t("settings.checkout.gratuity"), hint: t("settings.checkout.gratuityHint") },
    { key: "allowSplitPayment", label: t("settings.checkout.split"), hint: t("settings.checkout.splitHint") },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.checkout.title")} subtitle={t("settings.checkout.subtitle")} />
      <Card className="space-y-4 p-5">
        {form
          ? toggles.map((x) => (
              <label key={x.key} className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={form[x.key]} onChange={(e) => setForm({ ...form, [x.key]: e.target.checked })} data-testid={`checkout-${x.key}`} />
                <span>
                  <span className="block font-medium">{x.label}</span>
                  <span className="block text-sm text-muted">{x.hint}</span>
                </span>
              </label>
            ))
          : <p className="text-muted">{t("common.loading")}</p>}
        <p className="rounded-lg bg-surface-2 p-3 text-sm text-muted">{t("settings.checkout.perOutlet")}</p>
        <div className="flex justify-end">
          <Button disabled={busy || !form} onClick={() => void submit()} data-testid="checkout-save">
            {t("common.save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
