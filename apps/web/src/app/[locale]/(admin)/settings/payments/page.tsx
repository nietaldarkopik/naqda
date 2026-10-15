"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CheckList, Field, Input, Modal, PageHeader, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings, type PaymentMethodRow } from "@/lib/settings";

export default function PaymentSettingsPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const toast = useToast();
  const { can } = useAuth();
  const { data, reload } = useSettings();
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<PaymentMethodRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editOutlets, setEditOutlets] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<PaymentMethodRow | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Paged<{ id: string; name: string }>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  if (!can("settings.manage")) return <p className="text-muted">{t("errors.forbidden")}</p>;

  const fail = (e: unknown) => toast(e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : t("errors.network"), "error");
  const label = (m: PaymentMethodRow) => m.name ?? tx(`cashier.methods.${m.key}`);

  const patch = async (m: PaymentMethodRow, body: Record<string, unknown>) => {
    try {
      await api(`/settings/payment-methods/${m.id}`, { method: "PATCH", json: body });
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const list = data?.paymentMethods ?? [];
    const a = list[index];
    const b = list[index + dir];
    if (!a || !b) return;
    await patch(a, { position: b.position });
    await patch(b, { position: a.position });
  };

  const create = async () => {
    setError("");
    try {
      await api("/settings/payment-methods", { method: "POST", json: { name } });
      setAdding(false);
      setName("");
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : t("errors.network"));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    await patch(editing, { name: editName.trim() || null, outletIds: editOutlets });
    setEditing(null);
    toast(t("common.saved"));
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/settings/payment-methods/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await reload();
    } catch (e) {
      fail(e);
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.payments.title")} subtitle={t("settings.payments.subtitle")}>
        <Button onClick={() => { setName(""); setError(""); setAdding(true); }}>
          <Plus size={16} aria-hidden /> {t("settings.payments.add")}
        </Button>
      </PageHeader>
      <Card>
        <table className="w-full" data-testid="method-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("settings.payments.availability")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.paymentMethods.map((m, i) => (
              <tr key={m.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-2.5 font-medium">
                  {label(m)} {m.isSystem ? <Badge>{t("settings.payments.builtIn")}</Badge> : null}
                  {m.key === "cash" ? <Badge tone="warn">{t("settings.payments.cashTag")}</Badge> : null}
                </td>
                <td className="px-4 py-2.5 text-muted">{m.outletIds.length === 0 ? t("common.allOutlets") : t("settings.payments.outletCount", { count: m.outletIds.length })}</td>
                <td className="px-4 py-2.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={m.enabled} disabled={m.key === "cash"} onChange={(e) => void patch(m, { enabled: e.target.checked })} aria-label={`${t("common.active")} ${label(m)}`} />
                    {m.enabled ? t("common.active") : t("common.inactive")}
                  </label>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" disabled={i === 0} onClick={() => void move(i, -1)} aria-label={t("settings.payments.up")}><ArrowUp size={15} aria-hidden /></Button>
                    <Button variant="ghost" disabled={i === (data.paymentMethods.length ?? 0) - 1} onClick={() => void move(i, 1)} aria-label={t("settings.payments.down")}><ArrowDown size={15} aria-hidden /></Button>
                    <Button variant="ghost" onClick={() => { setEditing(m); setEditName(m.name ?? ""); setEditOutlets(m.outletIds); }} aria-label={`${t("common.edit")} ${label(m)}`}>{t("common.edit")}</Button>
                    {!m.isSystem ? (
                      <Button variant="ghost" onClick={() => setDeleting(m)} aria-label={`${t("common.delete")} ${label(m)}`}><Trash2 size={15} className="text-danger" aria-hidden /></Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal
        open={adding}
        title={t("settings.payments.add")}
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
            <Button disabled={!name.trim()} onClick={() => void create()} data-testid="method-create">{t("common.save")}</Button>
          </>
        }
      >
        <Field label={t("common.name")} hint={t("settings.payments.nameHint")} error={error || undefined}>{(id) => <Input id={id} value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />}</Field>
      </Modal>

      <Modal
        open={editing !== null}
        title={editing ? label(editing) : ""}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => void saveEdit()}>{t("common.save")}</Button>
          </>
        }
      >
        <Field label={t("settings.payments.displayName")} hint={t("settings.payments.displayNameHint")}>{(id) => <Input id={id} value={editName} maxLength={80} onChange={(e) => setEditName(e.target.value)} />}</Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("settings.payments.availability")}</legend>
          <p className="text-xs text-muted">{t("settings.payments.availabilityHint")}</p>
          <CheckList options={outlets.map((o) => ({ value: o.id, label: o.name }))} value={editOutlets} onChange={setEditOutlets} />
        </fieldset>
      </Modal>

      <Modal
        open={deleting !== null}
        title={t("common.delete")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => void remove()}>{t("common.delete")}</Button>
          </>
        }
      >
        <p>{t("common.confirmDelete")}</p>
        <p className="font-medium">{deleting ? label(deleting) : ""}</p>
        <p className="text-sm text-muted">{t("settings.payments.deleteHint")}</p>
      </Modal>
    </div>
  );
}
