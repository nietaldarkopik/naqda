"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@naqdi/i18n";
import { TranslationFields, useTranslationDraft } from "@/components/TranslationFields";
import { Badge, Button, Card, CheckList, DataTable, Field, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, parseMajor, toMajorInput } from "@/lib/money";
import { useList } from "@/lib/useList";

interface Bundle {
  id: string;
  name: string;
  price: number;
  status: "active" | "inactive";
  items: Array<{ variantId: string; quantity: number; itemName: string; variantName: string }>;
  prices: Array<{ salesTypeId: string; price: number }>;
  outletIds: string[];
}
interface VariantHit {
  id: string;
  itemName: string;
  name: string;
  sku: string | null;
  basePrice: number;
}
interface Part {
  variantId: string;
  label: string;
  quantity: string;
}
interface Named {
  id: string;
  name: string;
}

export default function BundlesPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("library.manage");
  const exponent = business?.currencyExponent ?? 0;
  const money = (m: number) => formatMinor(m, exponent, business?.currency ?? "IDR", locale);

  const list = useList<Bundle>("/bundles");
  const [salesTypes, setSalesTypes] = useState<Named[]>([]);
  const [outlets, setOutlets] = useState<Named[]>([]);
  const [editing, setEditing] = useState<Bundle | "new" | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [parts, setParts] = useState<Part[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [allOutlets, setAllOutlets] = useState(true);
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Bundle | null>(null);
  const tr = useTranslationDraft("bundle");

  useEffect(() => {
    api<Paged<Named>>("/sales-types?pageSize=100").then((r) => setSalesTypes(r.items)).catch(() => undefined);
    api<Paged<Named>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (editing === null || search.trim().length < 1) return setHits([]);
    const id = setTimeout(() => {
      api<{ items: VariantHit[] }>(`/items/variants?q=${encodeURIComponent(search.trim())}&limit=8`).then((r) => setHits(r.items)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(id);
  }, [search, editing]);

  const open = (row: Bundle | "new") => {
    if (row === "new") {
      setName(""); setPrice(""); setStatus("active"); setParts([]); setPrices({}); setAllOutlets(true); setOutletIds([]);
    } else {
      setName(row.name);
      setPrice(toMajorInput(row.price, exponent));
      setStatus(row.status);
      setParts(row.items.map((i) => ({ variantId: i.variantId, label: `${i.itemName} - ${i.variantName}`, quantity: String(i.quantity) })));
      setPrices(Object.fromEntries(row.prices.map((p) => [p.salesTypeId, toMajorInput(p.price, exponent)])));
      setAllOutlets(outlets.length > 0 && row.outletIds.length === outlets.length);
      setOutletIds(row.outletIds);
    }
    setSearch(""); setHits([]); setErrors({});
    if (row === "new") tr.reset();
    else void tr.load(row.id);
    setEditing(row);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const bad: Record<string, string> = {};
    const base = parseMajor(price, exponent);
    if (base === null) bad.price = t("common.invalidNumber");
    const salesPrices: Array<{ salesTypeId: string; price: number }> = [];
    for (const [salesTypeId, text] of Object.entries(prices)) {
      if (text.trim() === "") continue;
      const p = parseMajor(text, exponent);
      if (p === null) bad.prices = t("common.invalidNumber");
      else salesPrices.push({ salesTypeId, price: p });
    }
    const items = parts.map((p) => ({ variantId: p.variantId, quantity: Math.max(1, Number(p.quantity) || 1) }));
    if (items.length === 0) bad.items = t("common.required");
    if (Object.keys(bad).length) return setErrors(bad);

    setBusy(true);
    setErrors({});
    try {
      const body = { name: name.trim(), price: base ?? 0, status, items, prices: salesPrices, ...(allOutlets ? { allOutlets: true } : { outletIds }) };
      const saved =
        editing === "new"
          ? await api<{ id: string }>("/bundles", { method: "POST", json: body })
          : await api<{ id: string }>(`/bundles/${(editing as Bundle).id}`, { method: "PATCH", json: body });
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
      await api(`/bundles/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const addPart = (h: VariantHit) => {
    setParts((cur) => (cur.some((p) => p.variantId === h.id) ? cur : [...cur, { variantId: h.id, label: `${h.itemName} - ${h.name}`, quantity: "1" }]));
    setSearch("");
    setHits([]);
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("catalog.bundles.title")} subtitle={list.data ? String(list.data.total) : undefined}>
        {manage ? (
          <Button onClick={() => open("new")}>
            <Plus size={16} aria-hidden /> {t("catalog.bundles.create")}
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
            { key: "items", header: t("catalog.bundles.components"), cell: (r) => <span className="text-muted">{r.items.map((i) => `${i.quantity}× ${i.itemName}`).join(", ")}</span> },
            { key: "price", header: t("common.price"), cell: (r) => <span className="ltr-text tabular-nums">{money(r.price)}</span> },
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
        title={editing === "new" ? t("catalog.bundles.create") : t("catalog.bundles.edit")}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" form="bundle-form" disabled={busy || !name.trim()}>{t("common.save")}</Button>
          </>
        }
      >
        <form id="bundle-form" onSubmit={save} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("common.name")} error={errors.name}>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={Boolean(errors.name)} maxLength={191} required />}
            </Field>
            <Field label={t("catalog.bundles.price")} error={errors.price}>
              {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={price} onChange={(e) => setPrice(e.target.value)} invalid={Boolean(errors.price)} />}
            </Field>
            <Field label={t("common.status")}>
              {(id) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
                  <option value="active">{t("common.active")}</option>
                  <option value="inactive">{t("common.inactive")}</option>
                </Select>
              )}
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t("catalog.bundles.components")}</legend>
            <div className="relative">
              <Input type="search" placeholder={t("catalog.bundles.searchVariant")} aria-label={t("catalog.bundles.searchVariant")} value={search} onChange={(e) => setSearch(e.target.value)} />
              {hits.length ? (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => addPart(h)} className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-surface-2">
                        <span>{h.itemName} - {h.name}</span>
                        <span className="ltr-text text-xs text-muted">{h.sku ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {parts.map((p, i) => (
              <div key={p.variantId} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2 rounded-md border border-line px-3 py-2">
                <span className="text-sm">{p.label}</span>
                <Input aria-label={t("catalog.bundles.quantity")} inputMode="numeric" dir="ltr" className="text-start" value={p.quantity} onChange={(e) => setParts((cur) => cur.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} />
                <Button variant="ghost" onClick={() => setParts((cur) => cur.filter((_, idx) => idx !== i))} aria-label={t("common.remove")}>
                  <Trash2 size={15} className="text-danger" aria-hidden />
                </Button>
              </div>
            ))}
            {errors.items ? <p className="text-xs text-danger">{errors.items}</p> : null}
          </fieldset>

          {salesTypes.length ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("catalog.bundles.salesTypePrices")}</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                {salesTypes.map((s) => (
                  <Field key={s.id} label={s.name} error={errors.prices}>
                    {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" placeholder={price} value={prices[s.id] ?? ""} onChange={(e) => setPrices((cur) => ({ ...cur, [s.id]: e.target.value }))} />}
                  </Field>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("catalog.items.availability")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allOutlets} onChange={(e) => setAllOutlets(e.target.checked)} />
              {t("common.allOutlets")}
            </label>
            {!allOutlets ? <CheckList options={outlets.map((o) => ({ value: o.id, label: o.name }))} value={outletIds} onChange={setOutletIds} /> : null}
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
