"use client";

import { Download, ImagePlus, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { Locale } from "@naqdi/i18n";
import { TranslationFields, useTranslationDraft } from "@/components/TranslationFields";
import { Badge, Button, Card, CheckList, DataTable, Field, Input, Modal, PageHeader, Pager, Select, Textarea, useToast } from "@/components/ui";
import { api, apiDownload, apiResult, apiUpload, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, parseMajor, toMajorInput } from "@/lib/money";
import { useList } from "@/lib/useList";

interface ItemRow {
  id: string;
  name: string;
  status: "active" | "inactive";
  imageUrl: string | null;
  categoryName: string | null;
  variantCount: number;
  minPrice: number | null;
  maxPrice: number | null;
}
interface FullVariant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: number;
  cost: number;
  prices: Array<{ salesTypeId: string; price: number }>;
}
interface FullItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  brandId: string | null;
  trackStock: boolean;
  status: "active" | "inactive";
  variants: FullVariant[];
  modifierSetIds: string[];
  outletIds: string[];
}
interface Named {
  id: string;
  name: string;
}
interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  basePrice: string;
  cost: string;
  prices: Record<string, string>;
}
interface Form {
  name: string;
  description: string;
  imageUrl: string;
  categoryId: string;
  brandId: string;
  trackStock: boolean;
  status: "active" | "inactive";
  variants: VariantForm[];
  modifierSetIds: string[];
  allOutlets: boolean;
  outletIds: string[];
}
interface ImportReport {
  dryRun: boolean;
  applied: boolean;
  created: number;
  updated: number;
  categoriesCreated: number;
  brandsCreated: number;
  errors: Array<{ line: number; code: string; field?: string; value?: string }>;
}

const emptyVariant = (name: string): VariantForm => ({ name, sku: "", barcode: "", basePrice: "", cost: "", prices: {} });

export default function ItemsPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("library.manage");
  const exponent = business?.currencyExponent ?? 0;
  const currency = business?.currency ?? "IDR";
  const money = (minor: number) => formatMinor(minor, exponent, currency, locale);

  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const list = useList<ItemRow>("/items", 10, { categoryId: categoryId || undefined, status: status || undefined });

  const [categories, setCategories] = useState<Named[]>([]);
  const [brands, setBrands] = useState<Named[]>([]);
  const [salesTypes, setSalesTypes] = useState<Named[]>([]);
  const [modifiers, setModifiers] = useState<Named[]>([]);
  const [outlets, setOutlets] = useState<Named[]>([]);

  const [editing, setEditing] = useState<ItemRow | "new" | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ItemRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const tr = useTranslationDraft("item");

  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [csvName, setCsvName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const load = <T,>(path: string, set: (v: T[]) => void) => api<Paged<T>>(`${path}?pageSize=100`).then((r) => set(r.items)).catch(() => undefined);
    void load("/categories", setCategories);
    void load("/brands", setBrands);
    void load("/sales-types", setSalesTypes);
    void load("/modifiers", setModifiers);
    void load("/outlets", setOutlets);
  }, []);

  const openNew = () => {
    setForm({
      name: "", description: "", imageUrl: "", categoryId: "", brandId: "", trackStock: false, status: "active",
      variants: [emptyVariant(t("catalog.items.defaultVariant"))], modifierSetIds: [], allOutlets: true, outletIds: [],
    });
    setErrors({});
    tr.reset();
    setEditing("new");
  };

  const openEdit = async (row: ItemRow) => {
    try {
      const item = await api<FullItem>(`/items/${row.id}`);
      setForm({
        name: item.name,
        description: item.description ?? "",
        imageUrl: item.imageUrl ?? "",
        categoryId: item.categoryId ?? "",
        brandId: item.brandId ?? "",
        trackStock: item.trackStock,
        status: item.status,
        variants: item.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku ?? "",
          barcode: v.barcode ?? "",
          basePrice: toMajorInput(v.basePrice, exponent),
          cost: toMajorInput(v.cost, exponent),
          prices: Object.fromEntries(v.prices.map((p) => [p.salesTypeId, toMajorInput(p.price, exponent)])),
        })),
        modifierSetIds: item.modifierSetIds,
        allOutlets: outlets.length > 0 && item.outletIds.length === outlets.length,
        outletIds: item.outletIds,
      });
      setErrors({});
      await tr.load(row.id);
      setEditing(row);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    }
  };

  const patchVariant = (i: number, patch: Partial<VariantForm>) =>
    setForm((f) => (f ? { ...f, variants: f.variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) } : f));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const bad: Record<string, string> = {};
    const variants = form.variants.map((v, i) => {
      const base = parseMajor(v.basePrice, exponent);
      if (base === null) bad[`variants.${i}.basePrice`] = t("common.invalidNumber");
      const cost = v.cost.trim() === "" ? 0 : parseMajor(v.cost, exponent);
      if (cost === null) bad[`variants.${i}.cost`] = t("common.invalidNumber");
      const prices: Array<{ salesTypeId: string; price: number }> = [];
      for (const [salesTypeId, text] of Object.entries(v.prices)) {
        if (text.trim() === "") continue;
        const p = parseMajor(text, exponent);
        if (p === null) bad[`variants.${i}.prices`] = t("common.invalidNumber");
        else prices.push({ salesTypeId, price: p });
      }
      return { ...(v.id ? { id: v.id } : {}), name: v.name.trim(), sku: v.sku.trim() || null, barcode: v.barcode.trim() || null, basePrice: base ?? 0, cost: cost ?? 0, prices };
    });
    if (Object.keys(bad).length) {
      setErrors(bad);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        imageUrl: form.imageUrl || null,
        categoryId: form.categoryId || null,
        brandId: form.brandId || null,
        trackStock: form.trackStock,
        status: form.status,
        variants,
        modifierSetIds: form.modifierSetIds,
        ...(form.allOutlets ? { allOutlets: true } : { outletIds: form.outletIds }),
      };
      const saved =
        editing === "new"
          ? await api<{ id: string }>("/items", { method: "POST", json: body })
          : await api<{ id: string }>(`/items/${(editing as ItemRow).id}`, { method: "PATCH", json: body });
      const translated = await tr.save(saved.id);
      setEditing(null);
      toast(translated ? t("common.saved") : t("catalog.translations.saveFailed"), translated ? "ok" : "error");
      await list.reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !form) return;
    setUploading(true);
    try {
      const { url } = await apiUpload<{ url: string }>("/uploads/image", file);
      setForm((f) => (f ? { ...f, imageUrl: url } : f));
      setErrors((cur) => ({ ...cur, file: "" }));
    } catch (err) {
      setErrors((cur) => ({ ...cur, file: err instanceof ApiError ? (err.fields?.file ?? err.message) : t("errors.network") }));
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/items/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setCsvName(file.name);
    setReport(null);
    setChecked(false);
  };

  const runImport = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const { body } = await apiResult<ImportReport>("/items/import", { method: "POST", json: { csv, dryRun } });
      setReport(body);
      if (dryRun) setChecked(body.errors.length === 0);
      else if (body.applied) {
        toast(t("catalog.csv.appliedOk"));
        await list.reload();
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  // Kode galat impor berasal dari server, jadi kuncinya tidak dikenal saat kompilasi.
  const issueText = (code: string, values: Record<string, string>) =>
    (t as unknown as (key: string, v?: Record<string, string>) => string)(`catalog.csv.issue.${code}`, values);

  const priceText = (r: ItemRow) =>
    r.minPrice === null ? "-" : r.minPrice === r.maxPrice ? money(r.minPrice) : `${money(r.minPrice)} - ${money(r.maxPrice ?? r.minPrice)}`;

  return (
    <div className="space-y-5">
      <PageHeader title={t("catalog.items.title")} subtitle={list.data ? String(list.data.total) : undefined}>
        <Button variant="secondary" onClick={() => apiDownload("/items/export", "naqdi-items.csv").catch((e) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"))}>
          <Download size={16} aria-hidden /> {t("common.export")}
        </Button>
        {manage ? (
          <>
            <Button variant="secondary" onClick={() => { setCsv(""); setCsvName(""); setReport(null); setChecked(false); setImportOpen(true); }}>
              <Upload size={16} aria-hidden /> {t("common.import")}
            </Button>
            <Button onClick={openNew}>
              <Plus size={16} aria-hidden /> {t("catalog.items.create")}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={list.q} onChange={(e) => list.setQ(e.target.value)} className="max-w-xs" />
          <Select aria-label={t("catalog.items.category")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-48">
            <option value="">{t("catalog.items.allCategories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select aria-label={t("common.status")} value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-40">
            <option value="">{t("catalog.items.allStatuses")}</option>
            <option value="active">{t("common.active")}</option>
            <option value="inactive">{t("common.inactive")}</option>
          </Select>
        </div>
        <DataTable
          columns={[
            {
              key: "name",
              header: t("common.name"),
              cell: (r) => (
                <span className="flex items-center gap-3">
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" className="size-9 rounded-md border border-line object-cover" loading="lazy" />
                  ) : (
                    <span className="grid size-9 place-items-center rounded-md border border-dashed border-line text-muted" aria-hidden>
                      <ImagePlus size={14} />
                    </span>
                  )}
                  <span className="font-medium">{r.name}</span>
                </span>
              ),
            },
            { key: "category", header: t("catalog.items.category"), cell: (r) => <span className="text-muted">{r.categoryName ?? t("catalog.items.noCategory")}</span> },
            { key: "variants", header: t("catalog.items.variants"), cell: (r) => <span className="text-muted">{t("catalog.items.variantCount", { count: r.variantCount })}</span> },
            { key: "price", header: t("catalog.items.priceRange"), cell: (r) => <span className="ltr-text tabular-nums">{priceText(r)}</span> },
            { key: "status", header: t("common.status"), cell: (r) => <Badge tone={r.status === "active" ? "good" : "neutral"}>{r.status === "active" ? t("common.active") : t("common.inactive")}</Badge> },
          ]}
          rows={list.data?.items ?? null}
          emptyText={t("common.noData")}
          loadingText={t("common.loading")}
          actions={
            manage
              ? (row) => (
                  <>
                    <Button variant="ghost" onClick={() => void openEdit(row)} aria-label={`${t("common.edit")} ${row.name}`}>
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
        open={editing !== null && form !== null}
        title={editing === "new" ? t("catalog.items.create") : t("catalog.items.edit")}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" form="item-form" disabled={busy || !form?.name.trim()}>{t("common.save")}</Button>
          </>
        }
      >
        {form ? (
          <form id="item-form" onSubmit={save} className="space-y-5" noValidate>
            <Field label={t("common.name")} error={errors.name}>
              {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={Boolean(errors.name)} maxLength={191} required />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("catalog.items.category")} error={errors.categoryId}>
                {(id) => (
                  <Select id={id} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">{t("catalog.items.noCategory")}</option>
                    {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </Select>
                )}
              </Field>
              <Field label={t("catalog.items.brand")} error={errors.brandId}>
                {(id) => (
                  <Select id={id} value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                    <option value="">{t("common.none")}</option>
                    {brands.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </Select>
                )}
              </Field>
              <Field label={t("common.status")}>
                {(id) => (
                  <Select id={id} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Form["status"] })}>
                    <option value="active">{t("common.active")}</option>
                    <option value="inactive">{t("common.inactive")}</option>
                  </Select>
                )}
              </Field>
            </div>
            <Field label={t("catalog.items.description")}>
              {(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} />}
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("catalog.items.image")}</legend>
              <div className="flex items-center gap-4">
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="" className="size-20 rounded-lg border border-line object-cover" />
                ) : (
                  <div className="grid size-20 place-items-center rounded-lg border border-dashed border-line text-muted" aria-hidden>
                    <ImagePlus size={22} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm hover:bg-surface-2">
                      <Upload size={15} aria-hidden /> {uploading ? t("common.loading") : t("catalog.items.uploadImage")}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onImage} disabled={uploading} />
                    </label>
                    {form.imageUrl ? (
                      <Button variant="ghost" onClick={() => setForm({ ...form, imageUrl: "" })}>
                        <Trash2 size={14} className="text-danger" aria-hidden /> {t("catalog.items.removeImage")}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted">{t("catalog.items.imageHint")}</p>
                  {errors.file || errors.imageUrl ? <p role="alert" className="text-xs text-danger">{errors.file || errors.imageUrl}</p> : null}
                </div>
              </div>
            </fieldset>

            <TranslationFields state={tr} fields={["name", "description"]} />

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">{t("catalog.items.variants")}</legend>
              <p className="text-xs text-muted">{t("catalog.items.salesTypePrices")}</p>
              {form.variants.map((v, i) => (
                <div key={v.id ?? `new-${i}`} className="space-y-3 rounded-lg border border-line bg-surface-2/50 p-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label={t("catalog.items.variantName")} error={errors[`variants.${i}.name`]}>
                      {(id) => <Input id={id} value={v.name} onChange={(e) => patchVariant(i, { name: e.target.value })} maxLength={191} />}
                    </Field>
                    <Field label={t("catalog.items.sku")} error={errors[`variants.${i}.sku`]}>
                      {(id) => <Input id={id} dir="ltr" className="text-start" value={v.sku} onChange={(e) => patchVariant(i, { sku: e.target.value })} invalid={Boolean(errors[`variants.${i}.sku`])} maxLength={64} />}
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label={t("catalog.barcodeLabel")} error={errors[`variants.${i}.barcode`]} hint={t("catalog.barcodeHint")}>
                        {(id) => (
                          <Input
                            id={id}
                            dir="ltr"
                            className="text-start"
                            value={v.barcode}
                            onChange={(e) => patchVariant(i, { barcode: e.target.value })}
                            // Scanner mengakhiri kode dengan Enter: jangan sampai itu mengirim formulir item.
                            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                            invalid={Boolean(errors[`variants.${i}.barcode`])}
                            maxLength={64}
                            autoComplete="off"
                            data-testid={`barcode-${i}`}
                          />
                        )}
                      </Field>
                    </div>
                    <Field label={t("catalog.items.basePrice")} error={errors[`variants.${i}.basePrice`]}>
                      {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={v.basePrice} onChange={(e) => patchVariant(i, { basePrice: e.target.value })} invalid={Boolean(errors[`variants.${i}.basePrice`])} />}
                    </Field>
                    <Field label={t("common.cost")} error={errors[`variants.${i}.cost`]}>
                      {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={v.cost} onChange={(e) => patchVariant(i, { cost: e.target.value })} invalid={Boolean(errors[`variants.${i}.cost`])} />}
                    </Field>
                  </div>
                  {salesTypes.length ? (
                    <div className="grid gap-3 sm:grid-cols-4">
                      {salesTypes.map((s) => (
                        <Field key={s.id} label={s.name} error={errors[`variants.${i}.prices`]}>
                          {(id) => (
                            <Input
                              id={id}
                              inputMode="decimal"
                              dir="ltr"
                              className="text-start"
                              placeholder={v.basePrice}
                              value={v.prices[s.id] ?? ""}
                              onChange={(e) => patchVariant(i, { prices: { ...v.prices, [s.id]: e.target.value } })}
                            />
                          )}
                        </Field>
                      ))}
                    </div>
                  ) : null}
                  {form.variants.length > 1 ? (
                    <div className="flex justify-end">
                      <Button variant="ghost" onClick={() => setForm({ ...form, variants: form.variants.filter((_, idx) => idx !== i) })}>
                        <Trash2 size={14} className="text-danger" aria-hidden /> {t("common.remove")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {errors.variants ? <p className="text-xs text-danger">{errors.variants}</p> : null}
              <Button variant="secondary" onClick={() => setForm({ ...form, variants: [...form.variants, emptyVariant("")] })}>
                <Plus size={14} aria-hidden /> {t("catalog.items.addVariant")}
              </Button>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} />
              {t("catalog.items.trackStock")}
            </label>

            {modifiers.length ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("catalog.items.modifierSets")}</legend>
                <CheckList options={modifiers.map((m) => ({ value: m.id, label: m.name }))} value={form.modifierSetIds} onChange={(v) => setForm({ ...form, modifierSetIds: v })} />
                {errors.modifierSetIds ? <p className="text-xs text-danger">{errors.modifierSetIds}</p> : null}
              </fieldset>
            ) : null}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("catalog.items.availability")}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.allOutlets} onChange={(e) => setForm({ ...form, allOutlets: e.target.checked })} />
                {t("common.allOutlets")}
              </label>
              {!form.allOutlets ? (
                <CheckList options={outlets.map((o) => ({ value: o.id, label: o.name }))} value={form.outletIds} onChange={(v) => setForm({ ...form, outletIds: v })} />
              ) : null}
              {errors.outletIds ? <p className="text-xs text-danger">{errors.outletIds}</p> : null}
            </fieldset>
          </form>
        ) : null}
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

      <Modal
        open={importOpen}
        title={t("catalog.csv.title")}
        onClose={() => setImportOpen(false)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>{t("common.close")}</Button>
            <Button variant="secondary" disabled={busy || !csv} onClick={() => void runImport(true)}>{t("catalog.csv.check")}</Button>
            <Button disabled={busy || !checked || report?.applied === true} onClick={() => void runImport(false)}>{t("catalog.csv.apply")}</Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t("catalog.csv.hint")}</p>
        <p className="text-sm font-medium">{t("catalog.csv.allOrNothing")}</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2">
          <Upload size={15} aria-hidden /> {csvName || t("catalog.csv.chooseFile")}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
        </label>
        {report ? (
          <div className="space-y-2 rounded-lg border border-line p-3 text-sm" role="status">
            {report.errors.length === 0 ? (
              <>
                <p className="font-medium text-brand-strong">{report.applied ? t("catalog.csv.appliedOk") : t("catalog.csv.checkedOk")}</p>
                <ul className="space-y-0.5 text-muted">
                  <li>{t("catalog.csv.resultCreated", { count: report.created })}</li>
                  <li>{t("catalog.csv.resultUpdated", { count: report.updated })}</li>
                  <li>{t("catalog.csv.resultCategories", { count: report.categoriesCreated })}</li>
                  <li>{t("catalog.csv.resultBrands", { count: report.brandsCreated })}</li>
                </ul>
              </>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto text-danger">
                {report.errors.slice(0, 100).map((e, i) => (
                  <li key={i}>
                    {e.line > 0 ? <strong>{t("catalog.csv.line", { line: e.line })}: </strong> : null}
                    {issueText(e.code, { field: e.field ?? "", value: e.value ?? "" })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
