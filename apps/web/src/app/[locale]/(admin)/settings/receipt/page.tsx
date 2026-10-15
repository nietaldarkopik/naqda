"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@naqdi/i18n";
import { ReceiptView, defaultReceiptSettings, type ReceiptData, type ReceiptSettings } from "@/components/ReceiptView";
import { Button, Card, Field, Input, PageHeader, Select, Textarea, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import { useSettings } from "@/lib/settings";

const toggles = ["showOutletName", "showOutletAddress", "showOutletPhone", "showCashier", "showTable", "showCustomer", "showTaxBreakdown"] as const;

export default function ReceiptSettingsPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const { data, save } = useSettings();
  const [form, setForm] = useState<ReceiptSettings>(defaultReceiptSettings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(data.receipt);
  }, [data]);

  const fmt = useMemo(() => (v: number) => formatMinor(v, business?.currencyExponent ?? 0, business?.currency ?? "IDR", locale), [business, locale]);
  // Data contoh: struk nyata memakai transaksi sungguhan; ini hanya untuk melihat tata letak.
  const sample: ReceiptData = useMemo(() => {
    const e = business?.currencyExponent ?? 0;
    const u = 10 ** e;
    return {
      businessName: business?.name ?? "Naqdi",
      outlet: { name: t("settings.receipt.sampleOutlet"), address: t("settings.receipt.sampleAddress"), phone: "021-5550123" },
      receiptNumber: 128,
      at: new Date(),
      cashier: t("settings.receipt.sampleCashier"),
      table: "M3",
      lines: [
        { id: "1", quantity: 2, name: t("settings.receipt.sampleItem1"), unitPrice: 22_000 * u, modifiers: [t("settings.receipt.sampleMod")], discount: 0 },
        { id: "2", quantity: 1, name: t("settings.receipt.sampleItem2"), unitPrice: 15_000 * u, modifiers: [], discount: 1_500 * u },
      ],
      subtotal: 59_000 * u,
      discountTotal: 1_500 * u,
      charges: [
        { name: t("settings.receipt.sampleService"), amount: 2_875 * u, kind: "gratuity" },
        { name: "PB1 10%", amount: 6_038 * u, kind: "tax" },
      ],
      rounding: 0,
      total: 66_413 * u,
      payments: [{ label: t("cashier.methods.cash"), amount: 70_000 * u }],
      change: 3_587 * u,
      refunded: 0,
      customer: { name: t("settings.receipt.sampleCustomer"), member: true, points: 24 },
      pointsRedeemed: 0,
      pointsEarned: 5,
      paid: true,
    };
  }, [business, t]);

  if (!can("settings.manage")) return <p className="text-muted">{t("errors.forbidden")}</p>;

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const r = await save("receipt", form);
    setBusy(false);
    if (r.ok) toast(t("common.saved"));
    else {
      setErrors(r.fields);
      toast(r.message, "error");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.receipt.title")} subtitle={t("settings.receipt.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card className="space-y-4 p-5">
          <Field label={t("settings.receipt.header")} hint={t("settings.receipt.headerHint")} error={errors.headerText}>
            {(id) => <Textarea id={id} rows={3} maxLength={200} value={form.headerText} onChange={(e) => setForm({ ...form, headerText: e.target.value })} data-testid="receipt-header" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.receipt.taxIdLabel")} hint={t("settings.receipt.taxIdLabelHint")} error={errors.taxIdLabel}>
              {(id) => <Input id={id} className="text-start" value={form.taxIdLabel} maxLength={30} placeholder="NPWP / VAT No." onChange={(e) => setForm({ ...form, taxIdLabel: e.target.value })} data-testid="receipt-taxid-label" />}
            </Field>
            <Field label={t("settings.receipt.taxId")} hint={t("settings.receipt.taxIdHint")} error={errors.taxId}>
              {(id) => <Input id={id} dir="ltr" className="text-start" value={form.taxId} maxLength={40} onChange={(e) => setForm({ ...form, taxId: e.target.value })} data-testid="receipt-taxid-input" />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.receipt.website")} error={errors.website}>
              {(id) => <Input id={id} dir="ltr" className="text-start" value={form.website} maxLength={120} onChange={(e) => setForm({ ...form, website: e.target.value })} />}
            </Field>
            <Field label={t("settings.receipt.instagram")} error={errors.instagram}>
              {(id) => <Input id={id} dir="ltr" className="text-start" value={form.instagram} maxLength={60} onChange={(e) => setForm({ ...form, instagram: e.target.value })} />}
            </Field>
          </div>
          <Field label={t("settings.receipt.footer")} hint={t("settings.receipt.footerHint")} error={errors.footerText}>
            {(id) => (
              <Input id={id} value={form.footerText ?? ""} placeholder={t("receipt.defaultFooter")} maxLength={300} onChange={(e) => setForm({ ...form, footerText: e.target.value === "" ? null : e.target.value })} data-testid="receipt-footer" />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.footerText === ""} onChange={(e) => setForm({ ...form, footerText: e.target.checked ? "" : null })} />
            {t("settings.receipt.noFooter")}
          </label>
          <Field label={t("settings.receipt.paper")}>
            {(id) => (
              <Select id={id} value={String(form.paperMm)} onChange={(e) => setForm({ ...form, paperMm: Number(e.target.value) === 58 ? 58 : 80 })} className="max-w-48" data-testid="receipt-paper">
                <option value="80">80 mm</option>
                <option value="58">58 mm</option>
              </Select>
            )}
          </Field>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">{t("settings.receipt.show")}</legend>
            {toggles.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} data-testid={`receipt-${k}`} />
                {t(`settings.receipt.toggles.${k}`)}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end">
            <Button disabled={busy} onClick={() => void submit()} data-testid="receipt-save">
              {t("common.save")}
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-muted">{t("settings.receipt.preview")}</h2>
          <div className="rounded-lg bg-white p-4 text-black shadow-inner" data-testid="receipt-preview">
            <ReceiptView data={sample} settings={form} fmt={fmt} />
          </div>
        </Card>
      </div>
    </div>
  );
}
