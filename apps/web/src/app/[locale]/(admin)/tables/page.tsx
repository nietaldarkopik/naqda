"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { Button, Card, Field, Input, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";

interface Group {
  id: string;
  name: string;
}
interface Table {
  id: string;
  name: string;
  groupId: string | null;
  capacity: number;
  x: number;
  y: number;
  shape: "rect" | "round";
}
interface OutletLite {
  id: string;
  name: string;
}

const COLS = 24;
const ROWS = 14;
const CELL = 44;
/** Lebar meja di denah (sel): 2, atau 3 untuk kapasitas besar. */
const widthOf = (capacity: number) => (capacity > 4 ? 3 : 2);
const emptyForm = { name: "", groupId: "", capacity: 2, shape: "rect" as Table["shape"] };

export default function TablesPage() {
  const t = useTranslations();
  const toast = useToast();
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [outletId, setOutletId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [items, setItems] = useState<Table[] | null>(null);
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [editing, setEditing] = useState<Table | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Table | null>(null);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  useEffect(() => {
    api<Paged<OutletLite>>("/outlets?pageSize=100")
      .then((r) => {
        setOutlets(r.items);
        setOutletId((cur) => cur || r.items[0]?.id || "");
      })
      .catch(failed);
  }, [failed]);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      const [g, tb] = await Promise.all([api<{ items: Group[] }>(`/tables/groups?outletId=${outletId}`), api<{ items: Table[] }>(`/tables?outletId=${outletId}`)]);
      setGroups(g.items);
      setItems(tb.items);
      setMoved({});
    } catch (e) {
      failed(e);
    }
  }, [outletId, failed]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const positioned = useMemo(() => (items ?? []).map((tb) => ({ ...tb, ...(moved[tb.id] ?? {}) })), [items, moved]);
  const dirty = Object.keys(moved).length > 0;

  // ---- geser meja di denah (pointer events: mouse, sentuh, pena)
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const onDown = (e: PointerEvent<HTMLButtonElement>, tb: Table & { x: number; y: number }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { id: tb.id, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const box = canvas.current?.getBoundingClientRect();
    if (!d || !box) return;
    const tb = positioned.find((p) => p.id === d.id);
    const x = Math.min(COLS - widthOf(tb?.capacity ?? 2), Math.max(0, Math.round((e.clientX - box.left - d.dx) / CELL)));
    const y = Math.min(ROWS - 1, Math.max(0, Math.round((e.clientY - box.top - d.dy) / CELL)));
    setMoved((m) => (m[d.id]?.x === x && m[d.id]?.y === y ? m : { ...m, [d.id]: { x, y } }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const saveLayout = async () => {
    setBusy(true);
    try {
      await api("/tables/layout", { method: "PUT", json: { outletId, items: Object.entries(moved).map(([id, p]) => ({ id, ...p })) } });
      toast(t("common.saved"));
      await load();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };

  const openForm = (tb: Table | "new") => {
    setErrors({});
    setForm(tb === "new" ? { ...emptyForm } : { name: tb.name, groupId: tb.groupId ?? "", capacity: tb.capacity, shape: tb.shape });
    setEditing(tb);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body = { name: form.name, groupId: form.groupId || null, capacity: form.capacity, shape: form.shape };
    try {
      if (editing === "new") {
        // Meja baru ditaruh di sel kosong pertama agar langsung terlihat di denah.
        const taken = new Set(positioned.map((p) => `${p.x},${p.y}`));
        let x = 0;
        let y = 0;
        while (taken.has(`${x},${y}`)) {
          x += 3;
          if (x >= COLS - 2) {
            x = 0;
            y += 2;
          }
        }
        await api("/tables", { method: "POST", json: { ...body, outletId, x, y } });
      } else if (editing) await api(`/tables/${editing.id}`, { method: "PATCH", json: body });
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
      await api(`/tables/${deleting.id}`, { method: "DELETE" });
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

  const addGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    try {
      await api("/tables/groups", { method: "POST", json: { outletId, name: groupName.trim() } });
      setGroupName("");
      await load();
    } catch (err) {
      failed(err);
    }
  };
  const removeGroup = async (g: Group) => {
    try {
      await api(`/tables/groups/${g.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      failed(err);
    }
  };

  const groupName_ = (id: string | null) => groups.find((g) => g.id === id)?.name;

  return (
    <div className="space-y-5">
      <PageHeader title={t("tables.title")} subtitle={t("tables.subtitle")}>
        <Select aria-label={t("devices.outlet")} value={outletId} onChange={(e) => setOutletId(e.target.value)} className="max-w-56">
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Button onClick={() => openForm("new")} disabled={!outletId}>
          <Plus size={16} aria-hidden /> {t("tables.create")}
        </Button>
      </PageHeader>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <p className="text-sm text-muted">{t("tables.dragHint")}</p>
          <Button disabled={!dirty || busy} onClick={() => void saveLayout()}>
            {t("tables.saveLayout")}
          </Button>
        </div>
        <div className="overflow-auto p-3">
          <div
            ref={canvas}
            data-testid="floor"
            className="relative rounded-lg border border-line bg-surface-2"
            style={{
              width: COLS * CELL,
              height: ROWS * CELL,
              backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
              backgroundSize: `${CELL}px ${CELL}px`,
              touchAction: "none",
            }}
          >
            {positioned.map((tb) => (
              <button
                key={tb.id}
                type="button"
                data-testid={`table-${tb.name}`}
                aria-label={tb.name}
                onPointerDown={(e) => onDown(e, tb)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onDoubleClick={() => openForm(tb)}
                className={`absolute grid cursor-grab place-items-center border border-brand bg-brand-soft text-xs font-medium active:cursor-grabbing ${tb.shape === "round" ? "rounded-full" : "rounded-md"} ${moved[tb.id] ? "ring-2 ring-brand" : ""}`}
                style={{ left: tb.x * CELL + 2, top: tb.y * CELL + 2, width: CELL * widthOf(tb.capacity) - 4, height: CELL - 4 }}
              >
                <span className="truncate px-1">{tb.name}</span>
              </button>
            ))}
            {items?.length === 0 ? <p className="absolute inset-0 grid place-items-center text-muted">{t("tables.empty")}</p> : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <table className="w-full">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("tables.group")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("tables.capacity")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items?.map((tb) => (
                <tr key={tb.id}>
                  <td className="px-4 py-2.5 font-medium">{tb.name}</td>
                  <td className="px-4 py-2.5 text-muted">{groupName_(tb.groupId) ?? "-"}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{tb.capacity}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openForm(tb)} aria-label={`${t("common.edit")} ${tb.name}`}>
                        <Pencil size={15} aria-hidden />
                      </Button>
                      <Button variant="ghost" onClick={() => setDeleting(tb)} aria-label={`${t("common.delete")} ${tb.name}`}>
                        <Trash2 size={15} className="text-danger" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {items && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">{t("tables.groups")}</h2>
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2">
                <span>{g.name}</span>
                <Button variant="ghost" onClick={() => void removeGroup(g)} aria-label={`${t("common.delete")} ${g.name}`}>
                  <Trash2 size={15} className="text-danger" aria-hidden />
                </Button>
              </li>
            ))}
            {groups.length === 0 ? <li className="py-2 text-sm text-muted">{t("common.noData")}</li> : null}
          </ul>
          <form onSubmit={addGroup} className="flex gap-2">
            <Input aria-label={t("tables.groupName")} placeholder={t("tables.groupName")} value={groupName} maxLength={120} onChange={(e) => setGroupName(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!groupName.trim()}>
              {t("tables.addGroup")}
            </Button>
          </form>
        </Card>
      </div>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t("tables.create") : t("tables.edit")}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="table-form" disabled={busy || !form.name.trim()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="table-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("common.name")} error={errors.name}>
            {(id) => <Input id={id} value={form.name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} invalid={Boolean(errors.name)} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("tables.group")} error={errors.groupId}>
              {(id) => (
                <Select id={id} value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}>
                  <option value="">-</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("tables.capacity")} error={errors.capacity}>
              {(id) => <Input id={id} type="number" min={1} max={99} dir="ltr" className="text-start" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Math.min(99, Math.max(1, Math.trunc(Number(e.target.value) || 1))) }))} />}
            </Field>
            <Field label={t("tables.shape")}>
              {(id) => (
                <Select id={id} value={form.shape} onChange={(e) => setForm((f) => ({ ...f, shape: e.target.value as Table["shape"] }))}>
                  <option value="rect">{t("tables.rect")}</option>
                  <option value="round">{t("tables.round")}</option>
                </Select>
              )}
            </Field>
          </div>
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
