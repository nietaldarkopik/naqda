"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";

type Status = "pending" | "active" | "expired" | "revoked";
interface Device {
  id: string;
  name: string;
  outletId: string;
  outletName: string | null;
  status: Status;
  activatedAt: string | null;
  lastSeenAt: string | null;
}
interface OutletLite {
  id: string;
  name: string;
}

const tone = (s: Status) => (s === "active" ? "good" : s === "revoked" ? "bad" : s === "expired" ? "warn" : "neutral");

export default function DevicesPage() {
  const t = useTranslations();
  const toast = useToast();
  const [items, setItems] = useState<Device[] | null>(null);
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ outletId: "", name: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ value: string; deviceName: string } | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Device[] }>("/devices")).items);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errors.network"), "error");
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
    api<Paged<OutletLite>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = await api<{ activationCode: string }>("/devices", { method: "POST", json: form });
      setCreating(false);
      setCode({ value: res.activationCode, deviceName: form.name });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (d: Device) => {
    try {
      const res = await api<{ activationCode: string }>(`/devices/${d.id}/code`, { method: "POST", json: {} });
      setCode({ value: res.activationCode, deviceName: d.name });
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api(`/devices/${revoking.id}`, { method: "DELETE" });
      setRevoking(null);
      toast(t("devices.revoked"));
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.network"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("devices.title")}</h1>
          <p className="text-sm text-muted">{t("devices.subtitle")}</p>
        </div>
        <Button
          onClick={() => {
            setForm({ outletId: outlets[0]?.id ?? "", name: "" });
            setErrors({});
            setCreating(true);
          }}
          disabled={outlets.length === 0}
        >
          <Plus size={16} aria-hidden /> {t("devices.create")}
        </Button>
      </header>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("devices.outlet")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("devices.lastSeen")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items?.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2/60">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-muted">{d.outletName ?? "-"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(d.status)}>{t(`devices.status.${d.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{d.lastSeenAt ? <span className="ltr-text">{new Date(d.lastSeenAt).toLocaleString()}</span> : "-"}</td>
                  <td className="px-4 py-3">
                    {d.status !== "revoked" ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => void regenerate(d)} aria-label={`${t("devices.newCode")} ${d.name}`} title={t("devices.newCode")}>
                          <KeyRound size={15} aria-hidden />
                        </Button>
                        <Button variant="ghost" onClick={() => setRevoking(d)} aria-label={`${t("devices.revoke")} ${d.name}`} title={t("devices.revoke")}>
                          <Trash2 size={15} className="text-danger" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    {t("common.noData")}
                  </td>
                </tr>
              ) : null}
              {!items ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={creating}
        title={t("devices.create")}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="device-form" disabled={busy || !form.name.trim() || !form.outletId}>
              {t("devices.generate")}
            </Button>
          </>
        }
      >
        <form id="device-form" onSubmit={create} className="space-y-4" noValidate>
          <Field label={t("devices.outlet")} error={errors.outletId}>
            {(id) => (
              <Select id={id} value={form.outletId} onChange={(e) => setForm((f) => ({ ...f, outletId: e.target.value }))}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("devices.name")} error={errors.name} hint={t("devices.nameHint")}>
            {(id) => <Input id={id} value={form.name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} invalid={Boolean(errors.name)} required />}
          </Field>
        </form>
      </Modal>

      <Modal
        open={code !== null}
        title={t("devices.codeTitle")}
        onClose={() => setCode(null)}
        footer={<Button onClick={() => setCode(null)}>{t("common.close")}</Button>}
      >
        <p className="text-sm">{t("devices.codeHelp", { name: code?.deviceName ?? "" })}</p>
        <p className="my-4 select-all rounded-lg bg-surface-2 py-4 text-center font-mono text-3xl font-semibold tracking-widest ltr-text" data-testid="activation-code">
          {code?.value}
        </p>
        <p className="text-xs text-muted">{t("devices.codeNote")}</p>
      </Modal>

      <Modal
        open={revoking !== null}
        title={t("devices.revoke")}
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={revoke} disabled={busy}>
              {t("devices.revoke")}
            </Button>
          </>
        }
      >
        <p>{t("devices.revokeConfirm")}</p>
        <p className="font-medium">{revoking?.name}</p>
      </Modal>
    </div>
  );
}
