"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { Locale } from "@naqdi/i18n";
import { TranslationFields, useTranslationDraft } from "@/components/TranslationFields";
import { Button, Card, DataTable, Field, Input, Modal, PageHeader, Pager, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, parseMajor, toMajorInput } from "@/lib/money";
import { useList } from "@/lib/useList";

interface Option {
  id: string;
  name: string;
  price: number;
}
interface ModSet {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number | null;
  itemCount: number;
  options: Option[];
}
interface OptionForm {
  id?: string;
  name: string;
  price: string;
}

export default function ModifiersPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("library.manage");
  const exponent = business?.currencyExponent ?? 0;
  const money = (m: number) => formatMinor(m, exponent, business?.currency ?? "IDR", locale);

  const list = useList<ModSet>("/modifiers");
  const [editing, setEditing] = useState<ModSet | "new" | null>(null);
  const [name, setName] = useState("");
  const [minSelect, setMinSelect] = useState("0");
  const [maxSelect, setMaxSelect] = useState("");
  const [options, setOptions] = useState<OptionForm[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ModSet | null>(null);
  const tr = useTranslationDraft("modifier_set");

  const open = (row: ModSet | "new") => {
    if (row === "new") {
      setName("");
      setMinSelect("0");
      setMaxSelect("");
      setOptions([{ name: "", price: "0" }]);
    } else {
      setName(row.name);
      setMinSelect(String(row.minSelect));
      setMaxSelect(row.maxSelect === null ? "" : String(row.maxSelect));
      setOptions(row.options.map((o) => ({ id: o.id, name: o.name, price: toMajorInput(o.price, exponent) })));
    }
    setErrors({});
    if (row === "new") tr.reset();
    else void tr.load(row.id);
    setEditing(row);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const bad: Record<string, string> = {};
    const parsed = options.map((o, i) => {
      const price = o.price.trim() === "" ? 0 : parseMajor(o.price, exponent);
      if (price === null) bad[`options.${i}.price`] = t("common.invalidNumber");
      return { ...(o.id ? { id: o.id } : {}), name: o.name.trim(), price: price ?? 0 };
    });
    if (Object.keys(bad).length) return setErrors(bad);
    setBusy(true);
    setErrors({});
    try {
      const body = { name: name.trim(), minSelect: Number(minSelect) || 0, maxSelect: maxSelect.trim() === "" ? null : Number(maxSelect), options: parsed };
      const saved =
        editing === "new"
          ? await api<{ id: string }>("/modifiers", { method: "POST", json: body })
          : await api<{ id: string }>(`/modifiers/${(editing as ModSet).id}`, { method: "PATCH", json: body });
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

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/modifiers/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const setOpt = (i: number, patch: Partial<OptionForm>) => setOptions((cur) => cur.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  return (
    <div className="space-y-5">
      <PageHeader title={t("catalog.modifiers.title")} subtitle={list.data ? String(list.data.total) : undefined}>
        {manage ? (
          <Button onClick={() => open("new")}>
            <Plus size={16} aria-hidden /> {t("catalog.modifiers.create")}
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
            {
              key: "options",
              header: t("catalog.modifiers.options"),
              cell: (r) => <span className="text-muted">{r.options.map((o) => `${o.name}${o.price ? ` (+${money(o.price)})` : ""}`).join(", ")}</span>,
            },
            { key: "range", header: `${t("common.from")}-${t("common.to")}`, cell: (r) => <span className="ltr-text tabular-nums">{r.minSelect}-{r.maxSelect ?? "∞"}</span> },
            { key: "items", header: t("nav.items"), cell: (r) => <span className="text-muted">{t("catalog.modifiers.itemCount", { count: r.itemCount })}</span> },
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
        title={editing === "new" ? t("catalog.modifiers.create") : t("catalog.modifiers.edit")}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" form="modifier-form" disabled={busy || !name.trim()}>{t("common.save")}</Button>
          </>
        }
      >
        <form id="modifier-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("common.name")} error={errors.name}>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={Boolean(errors.name)} maxLength={191} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("catalog.modifiers.minSelect")} error={errors.minSelect}>
              {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={minSelect} onChange={(e) => setMinSelect(e.target.value)} invalid={Boolean(errors.minSelect)} />}
            </Field>
            <Field label={t("catalog.modifiers.maxSelect")} error={errors.maxSelect}>
              {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value)} invalid={Boolean(errors.maxSelect)} />}
            </Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t("catalog.modifiers.options")}</legend>
            {options.map((o, i) => (
              <div key={o.id ?? `n${i}`} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <Field label={t("catalog.modifiers.optionName")}>
                  {(id) => <Input id={id} value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} maxLength={191} />}
                </Field>
                <Field label={t("common.price")} error={errors[`options.${i}.price`]}>
                  {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={o.price} onChange={(e) => setOpt(i, { price: e.target.value })} />}
                </Field>
                <Button variant="ghost" disabled={options.length <= 1} onClick={() => setOptions((cur) => cur.filter((_, idx) => idx !== i))} aria-label={t("common.remove")}>
                  <Trash2 size={15} className="text-danger" aria-hidden />
                </Button>
              </div>
            ))}
            {errors.options ? <p className="text-xs text-danger">{errors.options}</p> : null}
            <Button variant="secondary" onClick={() => setOptions((cur) => [...cur, { name: "", price: "0" }])}>
              <Plus size={14} aria-hidden /> {t("catalog.modifiers.addOption")}
            </Button>
          </fieldset>
          <TranslationFields state={tr} />
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
