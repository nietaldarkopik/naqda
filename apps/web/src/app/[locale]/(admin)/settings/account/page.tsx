"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, PageHeader, useToast } from "@/components/ui";
import { api, type Paged } from "@/lib/api";
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

  useEffect(() => {
    if (data) setSlots(data.account.employeeSlots === null ? "" : String(data.account.employeeSlots));
  }, [data]);
  useEffect(() => {
    api<Paged<{ status: string }>>("/employees?pageSize=100").then((r) => setUsed(r.items.filter((e) => e.status !== "inactive").length)).catch(() => undefined);
  }, []);

  if (!can("settings.manage")) return <p className="text-muted">{t("errors.forbidden")}</p>;

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
