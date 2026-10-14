"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@naqdi/i18n";
import { Badge, Button, Card, CheckList, DataTable, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bpToInput, formatMinor, parseMajor, parsePercentBp, toMajorInput } from "@/lib/money";
import { useList } from "@/lib/useList";

type PromoType = "item_discount" | "free_item";
type RewardKind = "percent" | "amount" | "free_item";

interface Promo {
  id: string;
  name: string;
  type: PromoType;
  status: "active" | "inactive";
  startsAt: string | null;
  endsAt: string | null;
  hours: { from: string; to: string } | null;
  weekdays: number[] | null;
  multiple: boolean;
  requirementScope: "item" | "category";
  requirementItemId: string | null;
  requirementCategoryId: string | null;
  requirementQuantity: number;
  rewardKind: RewardKind;
  rewardValue: number;
  rewardItemId: string | null;
  rewardQuantity: number;
  outletIds: string[];
  salesTypeIds: string[];
}
interface Named {
  id: string;
  name: string;
}
interface Form {
  name: string;
  type: PromoType;
  status: "active" | "inactive";
  scope: "item" | "category";
  requirementItemId: string;
  requirementCategoryId: string;
  requirementQuantity: string;
  rewardKind: RewardKind;
  rewardValue: string;
  rewardItemId: string;
  rewardQuantity: string;
  startsAt: string;
  endsAt: string;
  hoursFrom: string;
  hoursTo: string;
  weekdays: string[];
  multiple: boolean;
  allOutlets: boolean;
  outletIds: string[];
  salesTypeIds: string[];
}

const emptyForm: Form = {
  name: "", type: "item_discount", status: "active", scope: "item", requirementItemId: "", requirementCategoryId: "",
  requirementQuantity: "1", rewardKind: "percent", rewardValue: "", rewardItemId: "", rewardQuantity: "1",
  startsAt: "", endsAt: "", hoursFrom: "", hoursTo: "", weekdays: [], multiple: false, allOutlets: true, outletIds: [], salesTypeIds: [],
};

/** ISO UTC -> nilai input datetime-local (waktu setempat pengguna). */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function PromosPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("library.manage");
  const exponent = business?.currencyExponent ?? 0;
  const money = (m: number) => formatMinor(m, exponent, business?.currency ?? "IDR", locale);
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { dateStyle: "medium" });

  const list = useList<Promo>("/promos");
  const [itemsLookup, setItemsLookup] = useState<Named[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  const [salesTypes, setSalesTypes] = useState<Named[]>([]);
  const [outlets, setOutlets] = useState<Named[]>([]);
  const [editing, setEditing] = useState<Promo | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Promo | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    api<Paged<Named>>("/items?pageSize=100").then((r) => setItemsLookup(r.items)).catch(() => undefined);
    api<Paged<Named>>("/categories?pageSize=100").then((r) => setCategories(r.items)).catch(() => undefined);
    api<Paged<Named>>("/sales-types?pageSize=100").then((r) => setSalesTypes(r.items)).catch(() => undefined);
    api<Paged<Named>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  const open = (row: Promo | "new") => {
    if (row === "new") setForm({ ...emptyForm, requirementItemId: itemsLookup[0]?.id ?? "" });
    else {
      setForm({
        name: row.name, type: row.type, status: row.status, scope: row.requirementScope,
        requirementItemId: row.requirementItemId ?? "", requirementCategoryId: row.requirementCategoryId ?? "",
        requirementQuantity: String(row.requirementQuantity), rewardKind: row.rewardKind,
        rewardValue: row.rewardKind === "percent" ? bpToInput(row.rewardValue) : row.rewardKind === "amount" ? toMajorInput(row.rewardValue, exponent) : "",
        rewardItemId: row.rewardItemId ?? "", rewardQuantity: String(row.rewardQuantity),
        startsAt: toLocalInput(row.startsAt), endsAt: toLocalInput(row.endsAt),
        hoursFrom: row.hours?.from ?? "", hoursTo: row.hours?.to ?? "",
        weekdays: (row.weekdays ?? []).map(String), multiple: row.multiple,
        allOutlets: outlets.length > 0 && row.outletIds.length === outlets.length, outletIds: row.outletIds, salesTypeIds: row.salesTypeIds,
      });
    }
    setErrors({});
    setStep(0);
    setEditing(row);
  };

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const lastStep = 3;
  /** Langkah boleh dilanjutkan bila bidang wajibnya terisi. Aturan lengkap tetap diperiksa server. */
  const stepValid = (n: number): boolean => {
    if (n === 0) return form.name.trim().length > 0;
    if (n === 1) return form.scope === "item" ? Boolean(form.requirementItemId) : Boolean(form.requirementCategoryId);
    if (n === 2) return form.rewardKind === "free_item" ? Boolean(form.rewardItemId) : form.rewardValue.trim().length > 0;
    return true;
  };
  const stepOfField = (field: string): number => {
    if (["name", "type", "status"].includes(field)) return 0;
    if (field.startsWith("requirement")) return 1;
    if (field.startsWith("reward")) return 2;
    return 3;
  };
  const stepLabels = [t("catalog.promos.step.info"), t("catalog.promos.step.requirement"), t("catalog.promos.step.reward"), t("catalog.promos.step.config")];

  const setType = (type: PromoType) => patch({ type, rewardKind: type === "free_item" ? "free_item" : form.rewardKind === "free_item" ? "percent" : form.rewardKind });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (step < lastStep) {
      if (stepValid(step)) setStep(step + 1);
      return;
    }
    const bad: Record<string, string> = {};
    let rewardValue = 0;
    if (form.rewardKind === "percent") {
      const bp = parsePercentBp(form.rewardValue);
      if (bp === null) bad.rewardValue = t("common.invalidNumber");
      else rewardValue = bp;
    } else if (form.rewardKind === "amount") {
      const m = parseMajor(form.rewardValue, exponent);
      if (m === null) bad.rewardValue = t("common.invalidNumber");
      else rewardValue = m;
    }
    if (Object.keys(bad).length) {
      setErrors(bad);
      return setStep(Math.min(...Object.keys(bad).map(stepOfField)));
    }
    if ((form.hoursFrom && !form.hoursTo) || (!form.hoursFrom && form.hoursTo)) {
      setErrors({ hours: t("common.required") });
      return setStep(3);
    }

    setBusy(true);
    setErrors({});
    try {
      const body = {
        name: form.name.trim(),
        type: form.type,
        status: form.status,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        hours: form.hoursFrom && form.hoursTo ? { from: form.hoursFrom, to: form.hoursTo } : null,
        weekdays: form.weekdays.length ? form.weekdays.map(Number) : null,
        multiple: form.multiple,
        requirementScope: form.scope,
        requirementItemId: form.scope === "item" ? form.requirementItemId || null : null,
        requirementCategoryId: form.scope === "category" ? form.requirementCategoryId || null : null,
        requirementQuantity: Math.max(1, Number(form.requirementQuantity) || 1),
        rewardKind: form.rewardKind,
        rewardValue,
        rewardItemId: form.rewardKind === "free_item" ? form.rewardItemId || null : null,
        rewardQuantity: Math.max(1, Number(form.rewardQuantity) || 1),
        salesTypeIds: form.salesTypeIds,
        ...(form.allOutlets ? { allOutlets: true } : { outletIds: form.outletIds }),
      };
      if (editing === "new") await api("/promos", { method: "POST", json: body });
      else if (editing) await api(`/promos/${editing.id}`, { method: "PATCH", json: body });
      setEditing(null);
      toast(t("common.saved"));
      await list.reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        setStep(Math.min(...Object.keys(err.fields).map(stepOfField)));
      } else toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/promos/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const rewardText = (p: Promo) =>
    p.rewardKind === "percent" ? `${p.rewardValue / 100}%` : p.rewardKind === "amount" ? money(p.rewardValue) : `${p.rewardQuantity}× ${itemsLookup.find((i) => i.id === p.rewardItemId)?.name ?? ""}`;

  const periodText = (p: Promo) =>
    p.startsAt || p.endsAt ? `${p.startsAt ? dateFmt.format(new Date(p.startsAt)) : "…"} – ${p.endsAt ? dateFmt.format(new Date(p.endsAt)) : "…"}` : "-";

  const selectOptions = (list: Named[], placeholder?: string) => (
    <>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {list.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t("catalog.promos.title")} subtitle={list.data ? String(list.data.total) : undefined}>
        {manage ? (
          <Button onClick={() => open("new")}>
            <Plus size={16} aria-hidden /> {t("catalog.promos.create")}
          </Button>
        ) : null}
      </PageHeader>
      <Card>
        <div className="border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={list.q} onChange={(e) => list.setQ(e.target.value)} className="max-w-xs" />
        </div>
        <DataTable
          columns={[
            { key: "name", header: t("common.name"), cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: "type", header: t("common.type"), cell: (r) => <span className="text-muted">{r.type === "item_discount" ? t("catalog.promos.itemDiscount") : t("catalog.promos.freeItem")}</span> },
            { key: "reward", header: t("catalog.promos.reward"), cell: (r) => <span className="ltr-text tabular-nums">{rewardText(r)}</span> },
            { key: "period", header: t("catalog.promos.schedule"), cell: (r) => <span className="text-muted">{periodText(r)}</span> },
            { key: "status", header: t("common.status"), cell: (r) => <Badge tone={r.status === "active" ? "good" : "neutral"}>{r.status === "active" ? t("common.active") : t("common.inactive")}</Badge> },
          ]}
          rows={list.data?.items ?? null}
          emptyText={t("common.noData")}
          loadingText={t("common.loading")}
          actions={
            manage
              ? (row) => (
                  <>
                    <Button variant="ghost" onClick={() => open(row)} aria-label={`${t("common.edit")} ${row.name}`}>
                      <Pencil size={15} aria-hidden />
                    </Button>
                    <Button variant="ghost" onClick={() => setDeleting(row)} aria-label={`${t("common.delete")} ${row.name}`}>
                      <Trash2 size={15} className="text-danger" aria-hidden />
                    </Button>
                  </>
                )
              : undefined
          }
        />
        {list.data ? <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} /> : null}
      </Card>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t("catalog.promos.create") : t("catalog.promos.edit")}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            {step > 0 ? <Button variant="secondary" onClick={() => setStep(step - 1)}>{t("common.back")}</Button> : null}
            {step < lastStep ? (
              <Button key="next" onClick={() => stepValid(step) && setStep(step + 1)} disabled={!stepValid(step)}>
                {t("common.continue")}
              </Button>
            ) : (
              // key berbeda: tanpa itu React memakai ulang elemen DOM yang sama, dan klik "Lanjut" di langkah
              // terakhir berubah menjadi submit di tengah event klik sehingga promo tersimpan tanpa ditinjau.
              <Button key="save" type="submit" form="promo-form" disabled={busy || !form.name.trim()}>
                {t("common.save")}
              </Button>
            )}
          </>
        }
      >
        <nav aria-label={t("catalog.promos.stepOf", { step: step + 1, total: lastStep + 1 })} className="mb-1">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {stepLabels.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (i <= step || [...Array(i).keys()].every(stepValid)) && setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-full px-3 py-1 ${i === step ? "bg-brand text-white" : i < step ? "bg-brand-soft text-brand-strong" : "bg-surface-2 text-muted"}`}
                >
                  <span className="tabular-nums">{i + 1}</span>
                  {label}
                </button>
                {i < lastStep ? <span aria-hidden className="text-muted">/</span> : null}
              </li>
            ))}
          </ol>
        </nav>
        <form id="promo-form" onSubmit={save} className="space-y-5" noValidate>
          <div className={step === 0 ? "space-y-5" : "hidden"}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("common.name")} error={errors.name}>
              {(id) => <Input id={id} value={form.name} onChange={(e) => patch({ name: e.target.value })} invalid={Boolean(errors.name)} maxLength={191} required />}
            </Field>
            <Field label={t("catalog.promos.type")}>
              {(id) => (
                <Select id={id} value={form.type} onChange={(e) => setType(e.target.value as PromoType)}>
                  <option value="item_discount">{t("catalog.promos.itemDiscount")}</option>
                  <option value="free_item">{t("catalog.promos.freeItem")}</option>
                </Select>
              )}
            </Field>
            <Field label={t("common.status")}>
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => patch({ status: e.target.value as Form["status"] })}>
                  <option value="active">{t("common.active")}</option>
                  <option value="inactive">{t("common.inactive")}</option>
                </Select>
              )}
            </Field>
          </div>

          </div>
          <div className={step === 1 ? "space-y-5" : "hidden"}>
          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{t("catalog.promos.requirement")}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("common.type")}>
                {(id) => (
                  <Select id={id} value={form.scope} onChange={(e) => patch({ scope: e.target.value as Form["scope"] })}>
                    <option value="item">{t("catalog.promos.scopeItem")}</option>
                    <option value="category">{t("catalog.promos.scopeCategory")}</option>
                  </Select>
                )}
              </Field>
              {form.scope === "item" ? (
                <Field label={t("nav.items")} error={errors.requirementItemId}>
                  {(id) => <Select id={id} value={form.requirementItemId} onChange={(e) => patch({ requirementItemId: e.target.value })} invalid={Boolean(errors.requirementItemId)}>{selectOptions(itemsLookup, "-")}</Select>}
                </Field>
              ) : (
                <Field label={t("catalog.items.category")} error={errors.requirementCategoryId}>
                  {(id) => <Select id={id} value={form.requirementCategoryId} onChange={(e) => patch({ requirementCategoryId: e.target.value })} invalid={Boolean(errors.requirementCategoryId)}>{selectOptions(categories, "-")}</Select>}
                </Field>
              )}
              <Field label={t("catalog.promos.requirementQuantity")} error={errors.requirementQuantity}>
                {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={form.requirementQuantity} onChange={(e) => patch({ requirementQuantity: e.target.value })} />}
              </Field>
            </div>
          </fieldset>

          </div>
          <div className={step === 2 ? "space-y-5" : "hidden"}>
          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{t("catalog.promos.reward")}</legend>
            {form.type === "item_discount" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("common.type")} error={errors.rewardKind}>
                  {(id) => (
                    <Select id={id} value={form.rewardKind} onChange={(e) => patch({ rewardKind: e.target.value as RewardKind, rewardValue: "" })}>
                      <option value="percent">{t("catalog.promos.rewardPercent")}</option>
                      <option value="amount">{t("catalog.promos.rewardAmount")}</option>
                    </Select>
                  )}
                </Field>
                <Field label={form.rewardKind === "percent" ? t("catalog.rate") : t("common.price")} error={errors.rewardValue}>
                  {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={form.rewardValue} onChange={(e) => patch({ rewardValue: e.target.value })} invalid={Boolean(errors.rewardValue)} />}
                </Field>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("catalog.promos.rewardItem")} error={errors.rewardItemId}>
                  {(id) => <Select id={id} value={form.rewardItemId} onChange={(e) => patch({ rewardItemId: e.target.value })} invalid={Boolean(errors.rewardItemId)}>{selectOptions(itemsLookup, "-")}</Select>}
                </Field>
                <Field label={t("catalog.promos.rewardQuantity")}>
                  {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={form.rewardQuantity} onChange={(e) => patch({ rewardQuantity: e.target.value })} />}
                </Field>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.multiple} onChange={(e) => patch({ multiple: e.target.checked })} />
              {t("catalog.promos.multiple")}
            </label>
          </fieldset>

          </div>
          <div className={step === 3 ? "space-y-5" : "hidden"}>
          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{t("catalog.promos.schedule")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("catalog.promos.startsAt")}>
                {(id) => <Input id={id} type="datetime-local" dir="ltr" className="text-start" value={form.startsAt} onChange={(e) => patch({ startsAt: e.target.value })} />}
              </Field>
              <Field label={t("catalog.promos.endsAt")} error={errors.endsAt}>
                {(id) => <Input id={id} type="datetime-local" dir="ltr" className="text-start" value={form.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} invalid={Boolean(errors.endsAt)} />}
              </Field>
              <Field label={`${t("catalog.promos.hours")}: ${t("common.from")}`} error={errors.hours}>
                {(id) => <Input id={id} type="time" dir="ltr" className="text-start" value={form.hoursFrom} onChange={(e) => patch({ hoursFrom: e.target.value })} />}
              </Field>
              <Field label={`${t("catalog.promos.hours")}: ${t("common.to")}`}>
                {(id) => <Input id={id} type="time" dir="ltr" className="text-start" value={form.hoursTo} onChange={(e) => patch({ hoursTo: e.target.value })} />}
              </Field>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t("catalog.promos.weekdays")}</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.weekdays.includes(String(d))}
                      onChange={() => patch({ weekdays: form.weekdays.includes(String(d)) ? form.weekdays.filter((x) => x !== String(d)) : [...form.weekdays, String(d)] })}
                    />
                    {t(`catalog.promos.day.${d}` as never)}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>

          {salesTypes.length ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("catalog.promos.salesTypes")}</legend>
              <CheckList options={salesTypes.map((s) => ({ value: s.id, label: s.name }))} value={form.salesTypeIds} onChange={(v) => patch({ salesTypeIds: v })} />
            </fieldset>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("catalog.items.availability")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.allOutlets} onChange={(e) => patch({ allOutlets: e.target.checked })} />
              {t("common.allOutlets")}
            </label>
            {!form.allOutlets ? <CheckList options={outlets.map((o) => ({ value: o.id, label: o.name }))} value={form.outletIds} onChange={(v) => patch({ outletIds: v })} /> : null}
          </fieldset>
          </div>
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
    </div>
  );
}
