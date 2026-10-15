"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, Field, Input, Modal, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Outlet {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  status: "active" | "inactive";
  pricesIncludeTax: boolean;
  pricesIncludeGratuity: boolean;
  taxOnGratuity: boolean;
  roundingStep: number;
  roundingMode: "nearest" | "up" | "down";
}

const emptyForm = {
  name: "",
  address: "",
  phone: "",
  timezone: "Asia/Jakarta",
  status: "active" as Outlet["status"],
  pricesIncludeTax: false,
  pricesIncludeGratuity: false,
  taxOnGratuity: true,
  roundingStep: 0,
  roundingMode: "nearest" as Outlet["roundingMode"],
  assignCatalog: true,
};
const zones = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Riyadh", "Asia/Dubai", "Asia/Singapore", "UTC"];
const pageSize = 10;

export default function OutletsPage() {
  const t = useTranslations();
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("outlets.manage");

  const [data, setData] = useState<Paged<Outlet> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Outlet | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Outlet | null>(null);
  const [originalTaxMode, setOriginalTaxMode] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Outlet>>(`/outlets?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    }
  }, [page, query, toast, t]);

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

  const openNew = () => {
    setForm(emptyForm);
    setOriginalTaxMode(false);
    setErrors({});
    setEditing("new");
  };
  const openEdit = (o: Outlet) => {
    setForm({ name: o.name, address: o.address ?? "", phone: o.phone ?? "", timezone: o.timezone, status: o.status, pricesIncludeTax: o.pricesIncludeTax, pricesIncludeGratuity: o.pricesIncludeGratuity, taxOnGratuity: o.taxOnGratuity, roundingStep: o.roundingStep, roundingMode: o.roundingMode, assignCatalog: true });
    setOriginalTaxMode(o.pricesIncludeTax);
    setErrors({});
    setEditing(o);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { assignCatalog, ...fields } = form;
      const body = { ...fields, address: form.address || null, phone: form.phone || null };
      if (editing === "new") await api("/outlets", { method: "POST", json: { ...body, assignCatalog } });
      else if (editing) await api(`/outlets/${editing.id}`, { method: "PATCH", json: body });
      setEditing(null);
      toast(t("common.saved"));
      await load();
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
      await api(`/outlets/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const set = (key: "name" | "address" | "phone" | "timezone" | "status") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("outlets.title")}</h1>
          {data ? <p className="text-sm text-muted">{t("outlets.count", { count: data.total })}</p> : null}
        </div>
        {manage ? (
          <Button onClick={openNew}>
            <Plus size={16} aria-hidden /> {t("outlets.create")}
          </Button>
        ) : null}
      </header>

      <Card>
        <div className="border-b border-line p-3">
          <Input
            type="search"
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.address")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.phone")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("outlets.timezone")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("outlets.taxMode")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
                {manage ? <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2/60">
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3 text-muted">{o.address ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{o.phone ? <span className="ltr-text">{o.phone}</span> : "-"}</td>
                  <td className="px-4 py-3 text-muted">
                    <span className="ltr-text">{o.timezone}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={o.pricesIncludeTax ? "good" : "neutral"}>{o.pricesIncludeTax ? t("outlets.taxIncluded") : t("outlets.taxExcluded")}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={o.status === "active" ? "good" : "neutral"}>
                      {o.status === "active" ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  {manage ? (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => openEdit(o)} aria-label={`${t("common.edit")} ${o.name}`}>
                          <Pencil size={15} aria-hidden />
                        </Button>
                        <Button variant="ghost" onClick={() => setDeleting(o)} aria-label={`${t("common.delete")} ${o.name}`}>
                          <Trash2 size={15} className="text-danger" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={manage ? 7 : 6} className="px-4 py-10 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
              {!data ? (
                <tr>
                  <td colSpan={manage ? 7 : 6} className="px-4 py-10 text-center text-muted">
                    {t("common.loading")}
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
        title={editing === "new" ? t("outlets.create") : t("outlets.edit")}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="outlet-form" disabled={busy || !form.name.trim()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="outlet-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("common.name")} error={errors.name}>
            {(id) => <Input id={id} value={form.name} onChange={set("name")} invalid={Boolean(errors.name)} maxLength={191} required />}
          </Field>
          <Field label={t("common.address")} error={errors.address}>
            {(id) => <Input id={id} value={form.address} onChange={set("address")} maxLength={500} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.phone")} error={errors.phone}>
              {(id) => <Input id={id} dir="ltr" className="text-start" value={form.phone} onChange={set("phone")} maxLength={32} />}
            </Field>
            <Field label={t("outlets.timezone")} error={errors.timezone}>
              {(id) => (
                <Select id={id} dir="ltr" value={form.timezone} onChange={set("timezone")}>
                  {zones.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label={t("common.status")}>
            {(id) => (
              <Select id={id} value={form.status} onChange={set("status")}>
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.inactive")}</option>
              </Select>
            )}
          </Field>

          <fieldset className="space-y-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{t("outlets.taxMode")}</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.pricesIncludeTax}
                onChange={(e) => setForm((f) => ({ ...f, pricesIncludeTax: e.target.checked }))}
              />
              <span>
                <span className="font-medium">{t("outlets.pricesIncludeTax")}</span>
                <span className="block text-xs text-muted">{t("outlets.pricesIncludeTaxHint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={form.pricesIncludeGratuity} onChange={(e) => setForm((f) => ({ ...f, pricesIncludeGratuity: e.target.checked }))} />
              <span>
                <span className="font-medium">{t("outlets.pricesIncludeGratuity")}</span>
                <span className="block text-xs text-muted">{t("outlets.pricesIncludeGratuityHint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={form.taxOnGratuity} onChange={(e) => setForm((f) => ({ ...f, taxOnGratuity: e.target.checked }))} />
              <span>
                <span className="font-medium">{t("outlets.taxOnGratuity")}</span>
                <span className="block text-xs text-muted">{t("outlets.taxOnGratuityHint")}</span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("outlets.roundingStep")} hint={t("outlets.roundingStepHint")} error={errors.roundingStep}>
                {(id) => (
                  <Input id={id} type="number" min={0} step={1} dir="ltr" className="text-start" value={form.roundingStep} onChange={(e) => setForm((f) => ({ ...f, roundingStep: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))} />
                )}
              </Field>
              <Field label={t("outlets.roundingMode")} error={errors.roundingMode}>
                {(id) => (
                  <Select id={id} value={form.roundingMode} onChange={(e) => setForm((f) => ({ ...f, roundingMode: e.target.value as Outlet["roundingMode"] }))}>
                    <option value="nearest">{t("outlets.roundNearest")}</option>
                    <option value="up">{t("outlets.roundUp")}</option>
                    <option value="down">{t("outlets.roundDown")}</option>
                  </Select>
                )}
              </Field>
            </div>
            {editing !== "new" && form.pricesIncludeTax !== originalTaxMode ? (
              <p role="status" className="rounded-md bg-warn-soft px-3 py-2 text-xs">
                {t("outlets.taxModeChangeWarning")}
              </p>
            ) : null}
          </fieldset>

          {editing === "new" ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.assignCatalog}
                onChange={(e) => setForm((f) => ({ ...f, assignCatalog: e.target.checked }))}
              />
              <span>
                <span className="font-medium">{t("outlets.assignCatalog")}</span>
                <span className="block text-xs text-muted">{t("outlets.assignCatalogHint")}</span>
              </span>
            </label>
          ) : null}
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
