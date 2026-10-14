"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "@naqdi/i18n";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bpToInput, formatMinor, parseMajor, parsePercentBp, toMajorInput } from "@/lib/money";
import { useList } from "@/lib/useList";
import { TranslationFields, useTranslationDraft } from "./TranslationFields";
import { Button, Card, CheckList, DataTable, Field, Input, Modal, Pager, PageHeader, Select, useToast, type Column } from "./ui";

export type FieldSpec =
  | { key: string; kind: "text"; label: string }
  | { key: string; kind: "percent"; label: string }
  | { key: string; kind: "money"; label: string }
  /** Nilai yang bergantung pada bidang lain: kindKey = "percent" memakai persen, selain itu uang. */
  | { key: string; kind: "dynamic"; label: string; kindKey: string }
  | { key: string; kind: "select"; label: string; options: Array<{ value: string; label: string }> }
  | { key: string; kind: "bool"; label: string }
  | { key: string; kind: "multi"; label: string; endpoint: string };

export interface SimpleCrudProps<R extends { id: string; name: string }> {
  endpoint: string;
  title: string;
  createLabel: string;
  editLabel: string;
  fields: FieldSpec[];
  /** Bidang hubungan outlet yang mendukung "Semua outlet" (mengirim allOutlets). */
  outletField?: string;
  columns?: (ctx: { money: (minor: number) => string; labelOf: (lookup: string, id: string) => string }) => Column<R>[];
  /** Nilai awal formulir baru. */
  defaults?: Record<string, unknown>;
  /** Jenis entitas untuk terjemahan nama (mis. "category"); kosong = tanpa terjemahan. */
  translatable?: string;
}

type Row = { id: string; name: string } & Record<string, unknown>;
type Lookup = Array<{ id: string; name: string }>;

export function SimpleCrud<R extends Row>(props: SimpleCrudProps<R>) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("library.manage");
  const exponent = business?.currencyExponent ?? 0;
  const currency = business?.currency ?? "IDR";

  const { data, page, setPage, q, setQ, reload, pageSize } = useList<R>(props.endpoint);
  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  const [editing, setEditing] = useState<R | "new" | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [allOutlets, setAllOutlets] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<R | null>(null);
  const tr = useTranslationDraft(props.translatable ?? "category");

  useEffect(() => {
    for (const f of props.fields) {
      if (f.kind === "multi") {
        api<Paged<{ id: string; name: string }>>(`${f.endpoint}?pageSize=100`)
          .then((r) => setLookups((cur) => ({ ...cur, [f.key]: r.items })))
          .catch(() => undefined);
      }
    }
    // Hanya saat dipasang; daftar bidang statis per halaman.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const money = (minor: number) => formatMinor(minor, exponent, currency, locale);
  const labelOf = (lookup: string, id: string) => lookups[lookup]?.find((l) => l.id === id)?.name ?? "";

  const initial = (row: R | null): Record<string, unknown> => {
    const out: Record<string, unknown> = { name: row?.name ?? "", ...(row ? {} : (props.defaults ?? {})) };
    for (const f of props.fields) {
      const v = row ? row[f.key] : (props.defaults?.[f.key] ?? undefined);
      if (f.kind === "dynamic") {
        const isPercent = (row ? row[f.kindKey] : props.defaults?.[f.kindKey]) === "percent";
        out[f.key] = v === undefined ? "" : isPercent ? bpToInput(Number(v)) : toMajorInput(Number(v), exponent);
      } else if (f.kind === "percent") out[f.key] = v === undefined ? "" : bpToInput(Number(v));
      else if (f.kind === "money") out[f.key] = v === undefined ? "" : toMajorInput(Number(v), exponent);
      else if (f.kind === "bool") out[f.key] = Boolean(v);
      else if (f.kind === "multi") out[f.key] = (v as string[] | undefined) ?? [];
      else out[f.key] = (v as string | undefined) ?? (f.kind === "select" ? (f.options[0]?.value ?? "") : "");
    }
    return out;
  };

  const open = (row: R | "new") => {
    setForm(initial(row === "new" ? null : row));
    if (props.outletField) {
      const ids = row === "new" ? [] : ((row[props.outletField] as string[] | undefined) ?? []);
      setAllOutlets(row === "new" ? true : ids.length > 0 && ids.length === (lookups[props.outletField]?.length ?? -1));
    }
    setErrors({});
    if (props.translatable) {
      if (row === "new") tr.reset();
      else void tr.load(row.id);
    }
    setEditing(row);
  };

  const buildBody = (): Record<string, unknown> | null => {
    const body: Record<string, unknown> = { name: String(form.name ?? "").trim() };
    const bad: Record<string, string> = {};
    for (const f of props.fields) {
      const v = form[f.key];
      if (f.kind === "dynamic") {
        const parsed = form[f.kindKey] === "percent" ? parsePercentBp(String(v)) : parseMajor(String(v), exponent);
        if (parsed === null) bad[f.key] = t("common.invalidNumber");
        else body[f.key] = parsed;
      } else if (f.kind === "percent") {
        const bp = parsePercentBp(String(v));
        if (bp === null) bad[f.key] = t("common.invalidNumber");
        else body[f.key] = bp;
      } else if (f.kind === "money") {
        const m = parseMajor(String(v), exponent);
        if (m === null) bad[f.key] = t("common.invalidNumber");
        else body[f.key] = m;
      } else body[f.key] = v;
    }
    if (props.outletField) {
      if (allOutlets) body.allOutlets = true;
    }
    if (Object.keys(bad).length) {
      setErrors(bad);
      return null;
    }
    return body;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = buildBody();
    if (!body) return;
    setBusy(true);
    setErrors({});
    try {
      const saved =
        editing === "new"
          ? await api<{ id: string }>(props.endpoint, { method: "POST", json: body })
          : await api<{ id: string }>(`${props.endpoint}/${(editing as R).id}`, { method: "PATCH", json: body });
      const translated = props.translatable ? await tr.save(saved.id) : true;
      setEditing(null);
      toast(translated ? t("common.saved") : t("catalog.translations.saveFailed"), translated ? "ok" : "error");
      await reload();
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
      await api(`${props.endpoint}/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<R>[] = props.columns
    ? props.columns({ money, labelOf })
    : [{ key: "name", header: t("common.name"), cell: (r) => <span className="font-medium">{r.name}</span> }];

  const field = (f: FieldSpec): ReactNode => {
    const set = (v: unknown) => setForm((cur) => ({ ...cur, [f.key]: v }));
    const err = errors[f.key];
    switch (f.kind) {
      case "text":
      case "percent":
      case "money":
      case "dynamic":
        return (
          <Field key={f.key} label={f.label} error={err}>
            {(id) => (
              <Input
                id={id}
                inputMode={f.kind === "text" ? "text" : "decimal"}
                dir={f.kind === "text" ? undefined : "ltr"}
                className={f.kind === "text" ? undefined : "text-start"}
                value={String(form[f.key] ?? "")}
                onChange={(e) => set(e.target.value)}
                invalid={Boolean(err)}
              />
            )}
          </Field>
        );
      case "select":
        return (
          <Field key={f.key} label={f.label} error={err}>
            {(id) => (
              <Select id={id} value={String(form[f.key] ?? "")} onChange={(e) => set(e.target.value)} invalid={Boolean(err)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        );
      case "bool":
        return (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(form[f.key])} onChange={(e) => set(e.target.checked)} />
            {f.label}
          </label>
        );
      case "multi": {
        const isOutlets = f.key === props.outletField;
        return (
          <fieldset key={f.key} className="space-y-2">
            <legend className="text-sm font-medium">{f.label}</legend>
            {isOutlets ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allOutlets} onChange={(e) => setAllOutlets(e.target.checked)} />
                {t("common.allOutlets")}
              </label>
            ) : null}
            {!(isOutlets && allOutlets) ? (
              <CheckList
                options={(lookups[f.key] ?? []).map((l) => ({ value: l.id, label: l.name }))}
                value={(form[f.key] as string[]) ?? []}
                onChange={set}
              />
            ) : null}
            {err ? <p className="text-xs text-danger">{err}</p> : null}
          </fieldset>
        );
      }
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={props.title} subtitle={data ? String(data.total) : undefined}>
        {manage ? (
          <Button onClick={() => open("new")}>
            <Plus size={16} aria-hidden /> {props.createLabel}
          </Button>
        ) : null}
      </PageHeader>

      <Card>
        <div className="border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        </div>
        <DataTable
          columns={columns}
          rows={data?.items ?? null}
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
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={editing !== null}
        title={editing === "new" ? props.createLabel : props.editLabel}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="simple-form" disabled={busy || !String(form.name ?? "").trim()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="simple-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("common.name")} error={errors.name}>
            {(id) => <Input id={id} value={String(form.name ?? "")} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} invalid={Boolean(errors.name)} maxLength={191} required />}
          </Field>
          {props.fields.map(field)}
          {props.translatable ? <TranslationFields state={tr} /> : null}
        </form>
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
