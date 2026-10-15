"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { localeLabels, locales, type Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Role {
  id: string;
  systemKey: string | null;
  name: string | null;
  accessType: string;
}
interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string | null;
  status: "active" | "inactive" | "invited";
  role: Role;
  outletIds: string[];
  hasPin?: boolean;
}
interface OutletLite {
  id: string;
  name: string;
}

const pageSize = 10;
const emptyForm = {
  name: "",
  email: "",
  phone: "",
  roleId: "",
  locale: "",
  status: "active" as "active" | "inactive",
  password: "",
  outletIds: [] as string[],
};

export default function EmployeesPage() {
  const t = useTranslations();
  const toast = useToast();
  const { user: me } = useAuth();

  const [data, setData] = useState<Paged<Employee> | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  const roleName = useCallback((r: Role) => (r.systemKey ? t(`roles.${r.systemKey}` as never) : (r.name ?? "-")), [t]);

  const load = useCallback(async () => {
    try {
      setData(await api<Paged<Employee>>(`/employees?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    }
  }, [page, query, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ items: Role[] }>("/roles").then((r) => setRoles(r.items)).catch(() => undefined);
    api<Paged<OutletLite>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQuery(q);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const savePin = async (remove: boolean) => {
    if (!editing || editing === "new") return;
    setPinBusy(true);
    setErrors((e) => ({ ...e, pin: "" }));
    try {
      if (remove) await api(`/employees/${editing.id}/pin`, { method: "DELETE" });
      else await api(`/employees/${editing.id}/pin`, { method: "POST", json: { pin } });
      setEditing({ ...editing, hasPin: !remove });
      setPin("");
      toast(t(remove ? "employees.pinRemoved" : "employees.pinSaved"));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.fields?.pin) setErrors((e) => ({ ...e, pin: err.fields!.pin! }));
      else toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setPinBusy(false);
    }
  };

  const openNew = () => {
    setPin("");
    setForm({ ...emptyForm, roleId: roles[0]?.id ?? "" });
    setErrors({});
    setEditing("new");
  };
  const openEdit = (u: Employee) => {
    setPin("");
    setForm({
      name: u.name,
      email: u.email,
      phone: u.phone ?? "",
      roleId: u.role.id,
      locale: u.locale ?? "",
      status: u.status === "inactive" ? "inactive" : "active",
      password: "",
      outletIds: u.outletIds,
    });
    setErrors({});
    setEditing(u);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        roleId: form.roleId,
        locale: form.locale || null,
        status: form.status,
        outletIds: form.outletIds,
      };
      if (form.password) body.password = form.password;
      if (editing === "new") await api("/employees", { method: "POST", json: body });
      else if (editing) await api(`/employees/${editing.id}`, { method: "PATCH", json: body });
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
      await api(`/employees/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: "name" | "email" | "phone" | "roleId" | "locale" | "status" | "password") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleOutlet = (id: string) =>
    setForm((f) => ({ ...f, outletIds: f.outletIds.includes(id) ? f.outletIds.filter((x) => x !== id) : [...f.outletIds, id] }));

  const isSelf = editing !== null && editing !== "new" && editing.id === me?.id;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("employees.title")}</h1>
        <Button onClick={openNew} disabled={roles.length === 0}>
          <Plus size={16} aria-hidden /> {t("employees.create")}
        </Button>
      </header>

      <Card>
        <div className="border-b border-line p-3">
          <Input type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.email")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.role")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.outlets")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((u) => (
                <tr key={u.id} className="hover:bg-surface-2/60">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-muted">
                    <span className="ltr-text">{u.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div>{roleName(u.role)}</div>
                    <div className="text-xs text-muted">{t(`roles.access.${u.role.accessType}` as never)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted tabular-nums">{u.outletIds.length}</td>
                  <td className="px-4 py-3">
                    <Badge tone={u.status === "active" ? "good" : "neutral"}>
                      {u.status === "active" ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openEdit(u)} aria-label={`${t("common.edit")} ${u.name}`}>
                        <Pencil size={15} aria-hidden />
                      </Button>
                      <Button variant="ghost" disabled={u.id === me?.id} onClick={() => setDeleting(u)} aria-label={`${t("common.delete")} ${u.name}`}>
                        <Trash2 size={15} className="text-danger" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
              {!data ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
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
        title={editing === "new" ? t("employees.create") : t("employees.edit")}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="employee-form" disabled={busy || !form.name.trim() || !form.email.trim() || !form.roleId}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="employee-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("common.name")} error={errors.name}>
            {(id) => <Input id={id} value={form.name} onChange={text("name")} invalid={Boolean(errors.name)} maxLength={191} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.email")} error={errors.email}>
              {(id) => <Input id={id} type="email" dir="ltr" className="text-start" value={form.email} onChange={text("email")} invalid={Boolean(errors.email)} required />}
            </Field>
            <Field label={t("common.phone")} error={errors.phone}>
              {(id) => <Input id={id} dir="ltr" className="text-start" value={form.phone} onChange={text("phone")} maxLength={32} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.role")} error={errors.roleId}>
              {(id) => (
                <Select id={id} value={form.roleId} onChange={text("roleId")} invalid={Boolean(errors.roleId)} disabled={isSelf}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleName(r)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("employees.locale")} error={errors.locale}>
              {(id) => (
                <Select id={id} value={form.locale} onChange={text("locale")}>
                  <option value="">-</option>
                  {locales.map((l) => (
                    <option key={l} value={l}>
                      {localeLabels[l as Locale]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field
            label={t("employees.password")}
            error={errors.password}
            {...(editing !== "new" ? { hint: t("employees.passwordHint") } : {})}
          >
            {(id) => (
              <Input id={id} type="password" dir="ltr" className="text-start" autoComplete="new-password" value={form.password} onChange={text("password")} invalid={Boolean(errors.password)} />
            )}
          </Field>
          <Field label={t("common.status")}>
            {(id) => (
              <Select id={id} value={form.status} onChange={text("status")} disabled={isSelf}>
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.inactive")}</option>
              </Select>
            )}
          </Field>
          {editing !== "new" && editing ? (
            <fieldset className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{t("employees.pinTitle")}</legend>
              <p className="text-xs text-muted">{editing.hasPin ? t("employees.pinSet") : t("employees.pinNotSet")}</p>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-40 flex-1">
                  <Field label={t("employees.pinNew")} error={errors.pin || undefined} hint={t("employees.pinHint")}>
                    {(id) => (
                      <Input id={id} type="password" inputMode="numeric" autoComplete="off" dir="ltr" className="text-start" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} invalid={Boolean(errors.pin)} />
                    )}
                  </Field>
                </div>
                <Button type="button" variant="secondary" className="mt-6" disabled={pinBusy || pin.length < 4} onClick={() => void savePin(false)}>
                  {t("employees.pinSave")}
                </Button>
                {editing.hasPin ? (
                  <Button type="button" variant="ghost" className="mt-6" disabled={pinBusy} onClick={() => void savePin(true)}>
                    {t("employees.pinRemove")}
                  </Button>
                ) : null}
              </div>
            </fieldset>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("employees.assignedOutlets")}</legend>
            {errors.outletIds ? <p className="text-xs text-danger">{errors.outletIds}</p> : null}
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2">
              {outlets.map((o) => (
                <label key={o.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={form.outletIds.includes(o.id)} onChange={() => toggleOutlet(o.id)} />
                  {o.name}
                </label>
              ))}
            </div>
          </fieldset>
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
