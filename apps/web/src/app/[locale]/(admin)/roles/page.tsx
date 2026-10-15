"use client";

import { Copy, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Role {
  id: string;
  systemKey: string | null;
  name: string | null;
  accessType: "app_only" | "backoffice_only" | "app_and_backoffice";
  isSystem: boolean;
  privileges: string[];
  users: number;
}

// Pengelompokan hak agar daftar mudah dibaca.
const groups: { key: string; privileges: string[] }[] = [
  { key: "backoffice", privileges: ["backoffice.view", "reports.view", "library.manage", "inventory.manage", "customers.manage", "tables.manage"] },
  { key: "admin", privileges: ["employees.manage", "outlets.manage", "settings.manage"] },
  { key: "pos", privileges: ["pos.sell", "pos.discount", "pos.void", "pos.refund", "shift.manage"] },
];

export default function RolesPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("employees.manage");
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [form, setForm] = useState({ name: "", accessType: "app_only" as Role["accessType"], privileges: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRoles((await api<{ items: Role[] }>("/roles")).items);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    }
  }, [toast, t]);
  useEffect(() => {
    if (manage) void load();
  }, [manage, load]);

  if (!manage) return <p className="text-muted">{t("errors.forbidden")}</p>;

  const roleName = (r: Role) => (r.systemKey ? tx(`roles.${r.systemKey}`) : (r.name ?? "-"));
  const open = (r: Role | "new", copyFrom?: Role) => {
    setErrors({});
    if (r === "new") setForm({ name: copyFrom ? `${roleName(copyFrom)} (2)` : "", accessType: copyFrom?.accessType ?? "app_only", privileges: copyFrom?.privileges ?? ["pos.sell"] });
    else setForm({ name: r.name ?? roleName(r), accessType: r.accessType, privileges: r.privileges });
    setEditing(r);
  };
  const toggle = (p: string) => setForm((f) => ({ ...f, privileges: f.privileges.includes(p) ? f.privileges.filter((x) => x !== p) : [...f.privileges, p] }));
  const readOnly = editing !== null && editing !== "new" && editing.isSystem;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (editing === "new") await api("/roles", { method: "POST", json: form });
      else if (editing) await api(`/roles/${editing.id}`, { method: "PATCH", json: form });
      setEditing(null);
      toast(t("common.saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/roles/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("roles.title")} subtitle={t("roles.subtitle")}>
        <Button onClick={() => open("new")}>
          <Plus size={16} aria-hidden /> {t("roles.create")}
        </Button>
      </PageHeader>
      <Card>
        <table className="w-full" data-testid="role-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("roles.accessLabel")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("roles.privilegeCount")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("roles.users")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {roles?.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-2.5 font-medium">
                  {roleName(r)} {r.isSystem ? <Badge><Lock size={11} className="me-1 inline" aria-hidden />{t("roles.builtIn")}</Badge> : null}
                </td>
                <td className="px-4 py-2.5 text-muted">{tx(`roles.access.${r.accessType}`)}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{r.privileges.length}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{r.users}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => open("new", r)} aria-label={`${t("roles.duplicate")} ${roleName(r)}`} title={t("roles.duplicate")}><Copy size={15} aria-hidden /></Button>
                    <Button variant="ghost" onClick={() => open(r)} aria-label={`${r.isSystem ? t("common.view") : t("common.edit")} ${roleName(r)}`}><Pencil size={15} aria-hidden /></Button>
                    {!r.isSystem ? <Button variant="ghost" onClick={() => setDeleting(r)} aria-label={`${t("common.delete")} ${roleName(r)}`}><Trash2 size={15} className="text-danger" aria-hidden /></Button> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">{t("roles.note")}</p>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t("roles.create") : readOnly ? t("roles.viewBuiltIn") : t("roles.edit")}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            {!readOnly ? <Button disabled={busy || !form.name.trim()} onClick={() => void save()} data-testid="role-save">{t("common.save")}</Button> : null}
          </>
        }
      >
        {readOnly ? <p className="rounded bg-surface-2 p-2 text-sm text-muted">{t("roles.builtInHint")}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("common.name")} error={errors.name}>{(id) => <Input id={id} value={form.name} maxLength={120} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} invalid={Boolean(errors.name)} />}</Field>
          <Field label={t("roles.accessLabel")}>
            {(id) => (
              <Select id={id} value={form.accessType} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, accessType: e.target.value as Role["accessType"] }))}>
                {(["app_only", "backoffice_only", "app_and_backoffice"] as const).map((a) => <option key={a} value={a}>{tx(`roles.access.${a}`)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g.key} className="space-y-1.5 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{tx(`roles.groups.${g.key}`)}</legend>
              {g.privileges.map((p) => (
                <label key={p} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={form.privileges.includes(p)} disabled={readOnly} onChange={() => toggle(p)} data-testid={`priv-${p}`} />
                  <span>
                    <span className="block">{tx(`roles.privileges.${p.replace(".", "_")}`)}</span>
                    <span className="block text-xs text-muted">{tx(`roles.privilegeHints.${p.replace(".", "_")}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {errors.privileges ? <p role="alert" className="text-sm text-danger">{errors.privileges}</p> : null}
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
        <p className="font-medium">{deleting ? roleName(deleting) : ""}</p>
      </Modal>
    </div>
  );
}
