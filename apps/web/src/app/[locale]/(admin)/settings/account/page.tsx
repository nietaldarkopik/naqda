"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { supportedCurrencies } from "@naqdi/domain";
import { Button, Card, Field, Input, PageHeader, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";

export default function AccountSettingsPage() {
  const t = useTranslations();
  const toast = useToast();
  const { can, business } = useAuth();
  const { data, save } = useSettings();
  const [slots, setSlots] = useState("");
  const [used, setUsed] = useState<number | null>(null);
  const [error, setError] = useState("");
  const locale = useLocale();
  const [currency, setCurrency] = useState("");
  const [current, setCurrent] = useState<{ currency: string; exponent: number; locked: boolean } | null>(null);
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "currency" });
    } catch {
      return null;
    }
  }, [locale]);

  useEffect(() => {
    if (data) setSlots(data.account.employeeSlots === null ? "" : String(data.account.employeeSlots));
  }, [data]);
  useEffect(() => {
    api<{ currency: string; exponent: number; locked: boolean }>("/settings/currency")
      .then((r) => {
        setCurrent(r);
        setCurrency(r.currency);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    api<Paged<{ status: string }>>("/employees?pageSize=100").then((r) => setUsed(r.items.filter((e) => e.status !== "inactive").length)).catch(() => undefined);
  }, []);

  if (!can("settings.manage")) return <p className="text-muted">{t("errors.forbidden")}</p>;

  const saveCurrency = async () => {
    if (!current || currency === current.currency) return;
    if (!window.confirm(t("settings.account.currencyConfirm", { code: currency }))) return;
    try {
      await api("/settings/currency", { method: "PUT", json: { currency } });
      toast(t("common.saved"));
      window.location.reload(); // seluruh angka di layar memakai mata uang bisnis
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    }
  };

  const submit = async () => {
    const n = slots.trim() === "" ? null : Number(slots);
    if (n !== null && (!Number.isInteger(n) || n < 1)) return setError(t("common.invalidNumber"));
    setError("");
    const r = await save("account", { employeeSlots: n });
    toast(r.ok ? t("common.saved") : r.message, r.ok ? "ok" : "error");
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.account.title")} subtitle={business?.name} />
      <Card className="space-y-4 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">{t("settings.account.business")}</dt><dd className="font-medium">{business?.name}</dd></div>
          <div><dt className="text-muted">{t("settings.account.currency")}</dt><dd className="font-medium">{business?.currency}</dd></div>
          <div><dt className="text-muted">{t("settings.account.activeEmployees")}</dt><dd className="font-medium tabular-nums" data-testid="slots-used">{used ?? "-"}</dd></div>
        </dl>
        <div className="space-y-2 border-t border-line pt-4" data-testid="currency-section">
          <Field label={t("settings.account.currency")} hint={current?.locked ? t("settings.currencyLocked") : t("settings.account.currencyHint")}>
            {(id) => (
              <div className="flex flex-wrap items-center gap-2">
                <Select id={id} className="max-w-sm" value={currency} disabled={!current || current.locked} onChange={(e) => setCurrency(e.target.value)} data-testid="currency-select">
                  {supportedCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {names?.of(c.code) ?? c.code} ({t("settings.account.decimals", { count: c.exponent })})
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" disabled={!current || current.locked || currency === current.currency} onClick={() => void saveCurrency()} data-testid="currency-save">
                  {t("settings.account.currencyApply")}
                </Button>
              </div>
            )}
          </Field>
        </div>
        <Field label={t("settings.account.slots")} hint={t("settings.account.slotsHint")} error={error || undefined}>
          {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="max-w-40 text-start" value={slots} onChange={(e) => setSlots(e.target.value)} data-testid="slots-input" />}
        </Field>
        <div className="flex justify-end">
          <Button onClick={() => void submit()} data-testid="account-save">{t("common.save")}</Button>
        </div>
      </Card>
    </div>
  );
}
