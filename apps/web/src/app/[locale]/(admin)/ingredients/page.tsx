"use client";

import { Factory, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { parseDecimal, useOutletChoice, useQtyFormat } from "@/lib/inventory";

interface Ingredient {
  id: string;
  name: string;
  kind: "raw" | "semi";
  unit: string;
  category: string | null;
  trackStock: boolean;
  yieldQty: number;
  defaultCost: number;
  recipe: { componentId: string; name: string; unit: string; quantity: number }[];
}
interface RecipeRow {
  componentId: string;
  quantity: string;
}

const emptyForm = { name: "", kind: "raw" as "raw" | "semi", unit: "g", category: "", trackStock: true, yieldQty: "1", defaultCost: "0", recipe: [] as RecipeRow[] };
const pageSize = 15;

export default function IngredientsPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const qty = useQtyFormat(locale);
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("inventory.manage");
  const [data, setData] = useState<Paged<Ingredient> | null>(null);
  const [all, setAll] = useState<Ingredient[]>([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Ingredient | null>(null);
  const [producing, setProducing] = useState<Ingredient | null>(null);
  const [batches, setBatches] = useState("1");
  const { outlets, outletId, setOutletId } = useOutletChoice();

  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Ingredient>>(`/ingredients?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}${kind ? `&kind=${kind}` : ""}`));
      setAll((await api<Paged<Ingredient>>("/ingredients?pageSize=200")).items);
    } catch (e) {
      failed(e);
    }
  }, [page, query, kind, failed]);

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

  const openForm = (i: Ingredient | "new") => {
    setErrors({});
    setForm(i === "new" ? emptyForm : { name: i.name, kind: i.kind, unit: i.unit, category: i.category ?? "", trackStock: i.trackStock, yieldQty: String(i.yieldQty), defaultCost: String(i.defaultCost), recipe: i.recipe.map((r) => ({ componentId: r.componentId, quantity: String(r.quantity) })) });
    setEditing(i);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const yieldQty = parseDecimal(form.yieldQty);
    const defaultCost = parseDecimal(form.defaultCost);
    const recipe = form.recipe.map((r) => ({ componentId: r.componentId, quantity: parseDecimal(r.quantity) }));
    const bad: Record<string, string> = {};
    if (yieldQty === null || yieldQty <= 0) bad.yieldQty = t("common.invalidNumber");
    if (defaultCost === null) bad.defaultCost = t("common.invalidNumber");
    if (form.kind === "semi" && recipe.some((r) => !r.componentId || r.quantity === null || r.quantity <= 0)) bad.recipe = t("common.invalidNumber");
    if (Object.keys(bad).length) return setErrors(bad);
    setBusy(true);
    setErrors({});
    const body = { name: form.name, kind: form.kind, unit: form.unit, category: form.category || null, trackStock: form.trackStock, yieldQty, defaultCost, recipe: form.kind === "semi" ? recipe : [] };
    try {
      if (editing === "new") await api("/ingredients", { method: "POST", json: body });
      else if (editing) await api(`/ingredients/${editing.id}`, { method: "PATCH", json: body });
      setEditing(null);
      toast(t("common.saved"));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else failed(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/ingredients/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await load();
    } catch (err) {
      failed(err);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const produce = async () => {
    const n = parseDecimal(batches);
    if (!producing || n === null || n <= 0) return;
    setBusy(true);
    try {
      const r = await api<{ produced: number }>("/inventory/produce", { method: "POST", json: { outletId, ingredientId: producing.id, batches: n } });
      toast(t("inventory.ingredients.produced", { qty: qty(r.produced), unit: producing.unit }));
      setProducing(null);
    } catch (err) {
      if (err instanceof ApiError && err.fields?.batches) toast(err.fields.batches, "error");
      else failed(err);
    } finally {
      setBusy(false);
    }
  };

  const componentOptions = all.filter((i) => editing === "new" || (editing && i.id !== editing.id));

  return (
    <div className="space-y-5">
      <PageHeader title={t("inventory.ingredients.title")} subtitle={data ? String(data.total) : undefined}>
        {manage ? (
          <Button onClick={() => openForm("new")}>
            <Plus size={16} aria-hidden /> {t("inventory.ingredients.create")}
          </Button>
        ) : null}
      </PageHeader>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select aria-label={t("inventory.ingredients.kind")} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className="max-w-44">
            <option value="">{t("inventory.ingredients.allKinds")}</option>
            <option value="raw">{t("inventory.ingredients.raw")}</option>
            <option value="semi">{t("inventory.ingredients.semi")}</option>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inventory.ingredients.kind")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inventory.ingredients.unit")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inventory.ingredients.category")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2/60">
                  <td className="px-4 py-2.5 font-medium">{i.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={i.kind === "semi" ? "warn" : "neutral"}>{t(`inventory.ingredients.${i.kind}`)}</Badge>
                    {!i.trackStock ? <Badge>{t("inventory.ingredients.notTracked")}</Badge> : null}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{i.unit}</td>
                  <td className="px-4 py-2.5 text-muted">{i.category ?? "-"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      {manage && i.kind === "semi" ? (
                        <Button variant="ghost" onClick={() => { setBatches("1"); setProducing(i); }} aria-label={`${t("inventory.ingredients.produce")} ${i.name}`} title={t("inventory.ingredients.produce")}>
                          <Factory size={15} aria-hidden />
                        </Button>
                      ) : null}
                      {manage ? (
                        <>
                          <Button variant="ghost" onClick={() => openForm(i)} aria-label={`${t("common.edit")} ${i.name}`}>
                            <Pencil size={15} aria-hidden />
                          </Button>
                          <Button variant="ghost" onClick={() => setDeleting(i)} aria-label={`${t("common.delete")} ${i.name}`}>
                            <Trash2 size={15} className="text-danger" aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t("inventory.ingredients.create") : t("inventory.ingredients.edit")}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="ingredient-form" disabled={busy || !form.name.trim() || !form.unit.trim()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="ingredient-form" onSubmit={save} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.name")} error={errors.name}>
              {(id) => <Input id={id} value={form.name} maxLength={191} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} invalid={Boolean(errors.name)} required />}
            </Field>
            <Field label={t("inventory.ingredients.kind")} error={errors.kind}>
              {(id) => (
                <Select id={id} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as "raw" | "semi" }))}>
                  <option value="raw">{t("inventory.ingredients.raw")}</option>
                  <option value="semi">{t("inventory.ingredients.semi")}</option>
                </Select>
              )}
            </Field>
            <Field label={t("inventory.ingredients.unit")} error={errors.unit} hint={t("inventory.ingredients.unitHint")}>
              {(id) => <Input id={id} value={form.unit} maxLength={16} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} invalid={Boolean(errors.unit)} required />}
            </Field>
            <Field label={t("inventory.ingredients.category")} error={errors.category}>
              {(id) => <Input id={id} value={form.category} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />}
            </Field>
            <Field label={t("inventory.ingredients.defaultCost")} error={errors.defaultCost} hint={t("inventory.ingredients.defaultCostHint")}>
              {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={form.defaultCost} onChange={(e) => setForm((f) => ({ ...f, defaultCost: e.target.value }))} invalid={Boolean(errors.defaultCost)} />}
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={form.trackStock} onChange={(e) => setForm((f) => ({ ...f, trackStock: e.target.checked }))} />
              {t("inventory.ingredients.trackStock")}
            </label>
          </div>

          {form.kind === "semi" ? (
            <fieldset className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{t("inventory.ingredients.recipe")}</legend>
              <Field label={t("inventory.ingredients.yield", { unit: form.unit })} error={errors.yieldQty}>
                {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="max-w-40 text-start" value={form.yieldQty} onChange={(e) => setForm((f) => ({ ...f, yieldQty: e.target.value }))} invalid={Boolean(errors.yieldQty)} />}
              </Field>
              {form.recipe.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select aria-label={t("inventory.ingredients.component")} value={r.componentId} onChange={(e) => setForm((f) => ({ ...f, recipe: f.recipe.map((x, j) => (j === i ? { ...x, componentId: e.target.value } : x)) }))} className="min-w-48 flex-1">
                    <option value="">-</option>
                    {componentOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.unit})
                      </option>
                    ))}
                  </Select>
                  <Input aria-label={t("inventory.ingredients.quantity")} inputMode="decimal" dir="ltr" className="w-32 text-start" value={r.quantity} onChange={(e) => setForm((f) => ({ ...f, recipe: f.recipe.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) }))} />
                  <Button variant="ghost" onClick={() => setForm((f) => ({ ...f, recipe: f.recipe.filter((_, j) => j !== i) }))} aria-label={t("inventory.remove")}>
                    <Trash2 size={15} className="text-danger" aria-hidden />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setForm((f) => ({ ...f, recipe: [...f.recipe, { componentId: "", quantity: "" }] }))}>
                <Plus size={14} aria-hidden /> {t("inventory.ingredients.addComponent")}
              </Button>
              {errors.recipe ? <p role="alert" className="text-sm text-danger">{errors.recipe}</p> : null}
            </fieldset>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={producing !== null}
        title={t("inventory.ingredients.produce")}
        onClose={() => setProducing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setProducing(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void produce()}>
              {t("inventory.ingredients.produce")}
            </Button>
          </>
        }
      >
        <p className="font-medium">{producing?.name}</p>
        <p className="text-sm text-muted">{t("inventory.ingredients.produceHelp", { yield: qty(producing?.yieldQty ?? 0), unit: producing?.unit ?? "" })}</p>
        <Field label={t("devices.outlet")}>
          {(id) => (
            <Select id={id} value={outletId} onChange={(e) => setOutletId(e.target.value)}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("inventory.ingredients.batches")}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={batches} onChange={(e) => setBatches(e.target.value)} />}</Field>
      </Modal>

      <Modal
        open={deleting !== null}
        title={t("common.delete")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("common.confirmDelete")}</p>
        <p className="font-medium">{deleting?.name}</p>
      </Modal>
    </div>
  );
}
