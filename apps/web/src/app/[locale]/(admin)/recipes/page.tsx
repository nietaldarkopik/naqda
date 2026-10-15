"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Modal, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { parseDecimal } from "@/lib/inventory";

type Tab = "variants" | "options";
interface Row {
  id: string;
  item?: string;
  variant?: string;
  option?: string;
  set?: string;
  trackStock?: boolean;
  lineCount: number;
}
interface Ing {
  id: string;
  name: string;
  unit: string;
}
interface EditLine {
  ingredientId: string;
  quantity: string;
}

const pageSize = 15;

export default function RecipesPage() {
  const t = useTranslations();
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("inventory.manage");
  const [tab, setTab] = useState<Tab>("variants");
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [ings, setIngs] = useState<Ing[]>([]);
  const [editing, setEditing] = useState<{ row: Row; title: string } | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);
  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Row>>(`/ingredients/recipes/${tab}?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`));
    } catch (e) {
      failed(e);
    }
  }, [tab, page, query, failed]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<Paged<Ing>>("/ingredients?pageSize=200").then((r) => setIngs(r.items)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQuery(q);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [tab]);

  const open = async (row: Row) => {
    try {
      const res = await api<{ lines: { ingredientId: string; quantity: number }[] }>(`/ingredients/recipes/${tab}/${row.id}`);
      setLines(res.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) })));
      setError("");
      setEditing({ row, title: tab === "variants" ? `${row.item} (${row.variant})` : `${row.set}: ${row.option}` });
    } catch (e) {
      failed(e);
    }
  };

  const save = async () => {
    if (!editing) return;
    const parsed = lines.map((l) => ({ ingredientId: l.ingredientId, quantity: parseDecimal(l.quantity) }));
    if (parsed.some((l) => !l.ingredientId || l.quantity === null || l.quantity <= 0)) return setError(t("common.invalidNumber"));
    setBusy(true);
    try {
      await api(`/ingredients/recipes/${tab}/${editing.row.id}`, { method: "PUT", json: { lines: parsed } });
      setEditing(null);
      toast(t("common.saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setError(Object.values(e.fields)[0] ?? e.message);
      else failed(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("inventory.recipes.title")} subtitle={t("inventory.recipes.subtitle")} />
      <div className="flex gap-2" role="tablist">
        {(["variants", "options"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 rounded-full border px-4 text-sm font-medium ${tab === k ? "border-brand bg-brand text-white" : "border-line bg-surface hover:bg-surface-2"}`}>
            {t(`inventory.recipes.${k}`)}
          </button>
        ))}
      </div>
      <Card>
        <div className="border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        </div>
        <table className="w-full" data-testid="recipe-list">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{tab === "variants" ? t("inventory.recipes.item") : t("inventory.recipes.option")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{tab === "variants" ? t("inventory.recipes.variant") : t("inventory.recipes.set")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("inventory.recipes.ingredients")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.items.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-2.5 font-medium">{tab === "variants" ? r.item : r.option}</td>
                <td className="px-4 py-2.5 text-muted">{tab === "variants" ? r.variant : r.set}</td>
                <td className="px-4 py-2.5">{r.lineCount > 0 ? <Badge tone="good">{t("inventory.recipes.count", { count: r.lineCount })}</Badge> : <span className="text-muted">-</span>}</td>
                <td className="px-4 py-2.5 text-end">
                  <Button variant="ghost" onClick={() => void open(r)} aria-label={`${manage ? t("common.edit") : t("common.view")} ${tab === "variants" ? r.item : r.option}`}>
                    <Pencil size={15} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  {t("common.noData")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={editing !== null}
        title={editing?.title ?? ""}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            {manage ? (
              <Button disabled={busy} onClick={() => void save()}>
                {t("common.save")}
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-sm text-muted">{tab === "variants" ? t("inventory.recipes.variantHelp") : t("inventory.recipes.optionHelp")}</p>
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label={t("inventory.ingredients.component")} value={l.ingredientId} disabled={!manage} onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))} className="min-w-48 flex-1">
              <option value="">-</option>
              {ings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.unit})
                </option>
              ))}
            </Select>
            <Input aria-label={t("inventory.ingredients.quantity")} inputMode="decimal" dir="ltr" className="w-28 text-start" value={l.quantity} disabled={!manage} onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            {manage ? (
              <Button variant="ghost" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))} aria-label={t("inventory.remove")}>
                <Trash2 size={15} className="text-danger" aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
        {manage ? (
          <Button variant="secondary" onClick={() => setLines((cur) => [...cur, { ingredientId: "", quantity: "" }])}>
            <Plus size={14} aria-hidden /> {t("inventory.ingredients.addComponent")}
          </Button>
        ) : null}
        {tab === "variants" && editing && !editing.row.trackStock ? <p className="rounded bg-warn-soft p-2 text-xs">{t("inventory.recipes.costNote")}</p> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </Modal>
    </div>
  );
}
