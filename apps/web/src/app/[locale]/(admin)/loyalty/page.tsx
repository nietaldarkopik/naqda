"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, parseMajor, toMajorInput } from "@/lib/money";

interface Program {
  enabled: boolean;
  pointMode: "spend" | "item";
  spendAmount: number;
  spendPoints: number;
  bonusNewMember: number;
  memberQuota: number | null;
  validFrom: string | null;
  validTo: string | null;
  requireCode: boolean;
  earnRules: { itemId: string | null; categoryId: string | null; pointsPerUnit: number }[];
  members: number;
}
interface Reward {
  id: string;
  name: string;
  pointsCost: number;
  kind: "percent_total" | "amount_total" | "item_discount";
  valueKind: "percent" | "amount";
  value: number;
  maxDiscount: number | null;
  minPurchase: number;
  itemId: string | null;
  categoryId: string | null;
  status: "active" | "inactive";
}
interface Lite {
  id: string;
  name: string;
}
interface RuleRow {
  target: string; // "item:<id>" atau "category:<id>"
  points: string;
}

const emptyReward = { name: "", pointsCost: "10", kind: "percent_total" as Reward["kind"], valueKind: "percent" as Reward["valueKind"], value: "10", maxDiscount: "", minPurchase: "0", target: "", status: "active" as Reward["status"] };

export default function LoyaltyPage() {
  const t = useTranslations();
  const tx = t as unknown as (k: string) => string;
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can, business } = useAuth();
  const manage = can("customers.manage");
  const exp = business?.currencyExponent ?? 0;
  const [program, setProgram] = useState<Program | null>(null);
  const [form, setForm] = useState({ enabled: false, pointMode: "spend" as Program["pointMode"], spendAmount: "10000", spendPoints: "1", bonusNewMember: "0", memberQuota: "", validFrom: "", validTo: "", requireCode: false, rules: [] as RuleRow[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [items, setItems] = useState<Lite[]>([]);
  const [cats, setCats] = useState<Lite[]>([]);
  const [editing, setEditing] = useState<Reward | "new" | null>(null);
  const [rf, setRf] = useState(emptyReward);
  const [rErrors, setRErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Reward | null>(null);
  const [busy, setBusy] = useState(false);

  const money = useMemo(() => (v: number) => formatMinor(v, exp, business?.currency ?? "IDR", locale), [business, exp, locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  const load = useCallback(async () => {
    try {
      const p = await api<Program>("/loyalty/program");
      setProgram(p);
      setForm({
        enabled: p.enabled,
        pointMode: p.pointMode,
        spendAmount: toMajorInput(p.spendAmount, exp),
        spendPoints: String(p.spendPoints),
        bonusNewMember: String(p.bonusNewMember),
        memberQuota: p.memberQuota === null ? "" : String(p.memberQuota),
        validFrom: p.validFrom ?? "",
        validTo: p.validTo ?? "",
        requireCode: p.requireCode,
        rules: p.earnRules.map((r) => ({ target: r.itemId ? `item:${r.itemId}` : `category:${r.categoryId}`, points: String(r.pointsPerUnit) })),
      });
      setRewards((await api<{ items: Reward[] }>("/loyalty/rewards")).items);
    } catch (e) {
      failed(e);
    }
  }, [exp, failed]);

  useEffect(() => {
    void load();
    api<Paged<Lite>>("/items?pageSize=100").then((r) => setItems(r.items)).catch(() => undefined);
    api<Paged<Lite>>("/categories?pageSize=100").then((r) => setCats(r.items)).catch(() => undefined);
  }, [load]);

  const saveProgram = async () => {
    const spendAmount = parseMajor(form.spendAmount, exp);
    const bad: Record<string, string> = {};
    if (spendAmount === null || spendAmount <= 0) bad.spendAmount = t("common.invalidNumber");
    const spendPoints = Number(form.spendPoints);
    if (!Number.isInteger(spendPoints) || spendPoints < 1) bad.spendPoints = t("common.invalidNumber");
    const bonus = Number(form.bonusNewMember || 0);
    if (!Number.isInteger(bonus) || bonus < 0) bad.bonusNewMember = t("common.invalidNumber");
    const quota = form.memberQuota.trim() === "" ? null : Number(form.memberQuota);
    if (quota !== null && (!Number.isInteger(quota) || quota < 1)) bad.memberQuota = t("common.invalidNumber");
    const rules = form.rules.map((r) => ({ itemId: r.target.startsWith("item:") ? r.target.slice(5) : null, categoryId: r.target.startsWith("category:") ? r.target.slice(9) : null, pointsPerUnit: Number(r.points) }));
    if (form.pointMode === "item" && rules.some((r) => (!r.itemId && !r.categoryId) || !Number.isInteger(r.pointsPerUnit) || r.pointsPerUnit < 1)) bad.earnRules = t("common.invalidNumber");
    if (Object.keys(bad).length) return setErrors(bad);
    setBusy(true);
    setErrors({});
    try {
      await api("/loyalty/program", {
        method: "PUT",
        json: { enabled: form.enabled, pointMode: form.pointMode, spendAmount, spendPoints, bonusNewMember: bonus, memberQuota: quota, validFrom: form.validFrom || null, validTo: form.validTo || null, requireCode: form.requireCode, earnRules: form.pointMode === "item" ? rules : [] },
      });
      toast(t("common.saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else failed(e);
    } finally {
      setBusy(false);
    }
  };

  const openReward = (r: Reward | "new") => {
    setRErrors({});
    setRf(r === "new" ? emptyReward : { name: r.name, pointsCost: String(r.pointsCost), kind: r.kind, valueKind: r.valueKind, value: r.valueKind === "percent" ? String(r.value / 100) : toMajorInput(r.value, exp), maxDiscount: r.maxDiscount === null ? "" : toMajorInput(r.maxDiscount, exp), minPurchase: toMajorInput(r.minPurchase, exp), target: r.itemId ? `item:${r.itemId}` : r.categoryId ? `category:${r.categoryId}` : "", status: r.status });
    setEditing(r);
  };

  const saveReward = async () => {
    const valueKind = rf.kind === "percent_total" ? "percent" : rf.kind === "amount_total" ? "amount" : rf.valueKind;
    const value = valueKind === "percent" ? Math.round(Number(rf.value.replace(",", ".")) * 100) : parseMajor(rf.value, exp);
    const maxDiscount = rf.maxDiscount.trim() === "" ? null : parseMajor(rf.maxDiscount, exp);
    const minPurchase = parseMajor(rf.minPurchase || "0", exp);
    const pointsCost = Number(rf.pointsCost);
    const bad: Record<string, string> = {};
    if (value === null || !Number.isFinite(value) || value < 1) bad.value = t("common.invalidNumber");
    if (rf.maxDiscount.trim() !== "" && maxDiscount === null) bad.maxDiscount = t("common.invalidNumber");
    if (minPurchase === null) bad.minPurchase = t("common.invalidNumber");
    if (!Number.isInteger(pointsCost) || pointsCost < 1) bad.pointsCost = t("common.invalidNumber");
    if (Object.keys(bad).length) return setRErrors(bad);
    setBusy(true);
    setRErrors({});
    const body = {
      name: rf.name,
      pointsCost,
      kind: rf.kind,
      valueKind,
      value,
      maxDiscount: valueKind === "percent" ? maxDiscount : null,
      minPurchase,
      itemId: rf.kind === "item_discount" && rf.target.startsWith("item:") ? rf.target.slice(5) : null,
      categoryId: rf.kind === "item_discount" && rf.target.startsWith("category:") ? rf.target.slice(9) : null,
      status: rf.status,
    };
    try {
      if (editing === "new") await api("/loyalty/rewards", { method: "POST", json: body });
      else if (editing) await api(`/loyalty/rewards/${editing.id}`, { method: "PATCH", json: body });
      setEditing(null);
      toast(t("common.saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setRErrors(e.fields);
      else failed(e);
    } finally {
      setBusy(false);
    }
  };

  const removeReward = async () => {
    if (!deleting) return;
    try {
      await api(`/loyalty/rewards/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast(t("common.deleted"));
      await load();
    } catch (e) {
      failed(e);
    }
  };

  const describe = (r: Reward) => {
    const v = r.valueKind === "percent" ? `${r.value / 100}%` : money(r.value);
    return r.kind === "item_discount" ? `${v} · ${items.find((i) => i.id === r.itemId)?.name ?? cats.find((c) => c.id === r.categoryId)?.name ?? "-"}` : v;
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("loyalty.title")} subtitle={program ? t("loyalty.members", { count: program.members }) : undefined} />

      <Card className="space-y-5 p-5">
        <label className="flex items-center gap-3 text-base font-medium">
          <input type="checkbox" className="h-5 w-5" checked={form.enabled} disabled={!manage} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} data-testid="loyalty-enabled" />
          {t("loyalty.enabled")}
        </label>

        <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={!manage}>
          <legend className="px-1 text-sm font-semibold">{t("loyalty.step1")}</legend>
          <div className="flex flex-wrap gap-4">
            {(["spend", "item"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="radio" name="pointMode" checked={form.pointMode === m} onChange={() => setForm((f) => ({ ...f, pointMode: m }))} />
                {t(`loyalty.mode.${m}`)}
              </label>
            ))}
          </div>
          {form.pointMode === "spend" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("loyalty.spendAmount")} error={errors.spendAmount} hint={t("loyalty.spendHint")}>
                {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={form.spendAmount} onChange={(e) => setForm((f) => ({ ...f, spendAmount: e.target.value }))} invalid={Boolean(errors.spendAmount)} />}
              </Field>
              <Field label={t("loyalty.spendPoints")} error={errors.spendPoints}>
                {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={form.spendPoints} onChange={(e) => setForm((f) => ({ ...f, spendPoints: e.target.value }))} invalid={Boolean(errors.spendPoints)} />}
              </Field>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">{t("loyalty.itemHint")}</p>
              {form.rules.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select aria-label={t("loyalty.target")} value={r.target} onChange={(e) => setForm((f) => ({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)) }))} className="min-w-56 flex-1">
                    <option value="">-</option>
                    <optgroup label={t("loyalty.items")}>{items.map((o) => <option key={o.id} value={`item:${o.id}`}>{o.name}</option>)}</optgroup>
                    <optgroup label={t("loyalty.categories")}>{cats.map((o) => <option key={o.id} value={`category:${o.id}`}>{o.name}</option>)}</optgroup>
                  </Select>
                  <Input aria-label={t("loyalty.pointsPerUnit")} inputMode="numeric" dir="ltr" className="w-28 text-start" value={r.points} onChange={(e) => setForm((f) => ({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)) }))} />
                  <Button variant="ghost" onClick={() => setForm((f) => ({ ...f, rules: f.rules.filter((_, j) => j !== i) }))} aria-label={t("inventory.remove")}><Trash2 size={15} className="text-danger" aria-hidden /></Button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setForm((f) => ({ ...f, rules: [...f.rules, { target: "", points: "1" }] }))}><Plus size={14} aria-hidden /> {t("loyalty.addRule")}</Button>
              {errors.earnRules ? <p role="alert" className="text-sm text-danger">{errors.earnRules}</p> : null}
            </div>
          )}
          <Field label={t("loyalty.bonus")} error={errors.bonusNewMember} hint={t("loyalty.bonusHint")}>
            {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="max-w-40 text-start" value={form.bonusNewMember} onChange={(e) => setForm((f) => ({ ...f, bonusNewMember: e.target.value }))} />}
          </Field>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={!manage}>
          <legend className="px-1 text-sm font-semibold">{t("loyalty.step3")}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("loyalty.quota")} error={errors.memberQuota} hint={t("loyalty.quotaHint")}>
              {(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={form.memberQuota} onChange={(e) => setForm((f) => ({ ...f, memberQuota: e.target.value }))} invalid={Boolean(errors.memberQuota)} />}
            </Field>
            <Field label={t("loyalty.validFrom")} error={errors.validFrom}>
              {(id) => <Input id={id} type="date" dir="ltr" className="text-start" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} />}
            </Field>
            <Field label={t("loyalty.validTo")}>
              {(id) => <Input id={id} type="date" dir="ltr" className="text-start" value={form.validTo} onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))} />}
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.requireCode} onChange={(e) => setForm((f) => ({ ...f, requireCode: e.target.checked }))} />
            <span>
              <span className="font-medium">{t("loyalty.requireCode")}</span>
              <span className="block text-xs text-muted">{t("loyalty.requireCodeHint")}</span>
            </span>
          </label>
        </fieldset>
        {manage ? (
          <div className="flex justify-end">
            <Button disabled={busy} onClick={() => void saveProgram()} data-testid="loyalty-save">{t("common.save")}</Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{t("loyalty.step2")}</h2>
          {manage ? <Button onClick={() => openReward("new")}><Plus size={16} aria-hidden /> {t("loyalty.addReward")}</Button> : null}
        </div>
        <table className="w-full" data-testid="reward-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("loyalty.rewardType")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("loyalty.value")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("loyalty.pointsCost")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("common.status")}</th>
              {manage ? <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rewards.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-muted">{tx(`loyalty.kinds.${r.kind}`)}</td>
                <td className="px-4 py-2.5 tabular-nums">{describe(r)}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{r.pointsCost}</td>
                <td className="px-4 py-2.5"><Badge tone={r.status === "active" ? "good" : "neutral"}>{r.status === "active" ? t("common.active") : t("common.inactive")}</Badge></td>
                {manage ? (
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openReward(r)} aria-label={`${t("common.edit")} ${r.name}`}><Pencil size={15} aria-hidden /></Button>
                      <Button variant="ghost" onClick={() => setDeleting(r)} aria-label={`${t("common.delete")} ${r.name}`}><Trash2 size={15} className="text-danger" aria-hidden /></Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {rewards.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{t("loyalty.noRewards")}</td></tr> : null}
          </tbody>
        </table>
      </Card>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t("loyalty.addReward") : t("loyalty.editReward")}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button disabled={busy || !rf.name.trim()} onClick={() => void saveReward()} data-testid="reward-save">{t("common.save")}</Button>
          </>
        }
      >
        <Field label={t("common.name")} error={rErrors.name}>{(id) => <Input id={id} value={rf.name} maxLength={191} onChange={(e) => setRf((f) => ({ ...f, name: e.target.value }))} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("loyalty.rewardType")}>
            {(id) => (
              <Select id={id} value={rf.kind} onChange={(e) => setRf((f) => ({ ...f, kind: e.target.value as Reward["kind"], valueKind: e.target.value === "amount_total" ? "amount" : "percent" }))}>
                {(["percent_total", "amount_total", "item_discount"] as const).map((k) => <option key={k} value={k}>{tx(`loyalty.kinds.${k}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t("loyalty.pointsCost")} error={rErrors.pointsCost}>{(id) => <Input id={id} inputMode="numeric" dir="ltr" className="text-start" value={rf.pointsCost} onChange={(e) => setRf((f) => ({ ...f, pointsCost: e.target.value }))} invalid={Boolean(rErrors.pointsCost)} />}</Field>
          {rf.kind === "item_discount" ? (
            <Field label={t("loyalty.valueKind")}>
              {(id) => (
                <Select id={id} value={rf.valueKind} onChange={(e) => setRf((f) => ({ ...f, valueKind: e.target.value as Reward["valueKind"] }))}>
                  <option value="percent">{t("catalog.discounts.percent")}</option>
                  <option value="amount">{t("catalog.discounts.amount")}</option>
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={(rf.kind === "percent_total" || (rf.kind === "item_discount" && rf.valueKind === "percent")) ? t("loyalty.valuePercent") : t("loyalty.valueAmount")} error={rErrors.value} hint={rf.kind === "item_discount" && rf.valueKind === "amount" ? t("loyalty.amountOneUnit") : undefined}>
            {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={rf.value} onChange={(e) => setRf((f) => ({ ...f, value: e.target.value }))} invalid={Boolean(rErrors.value)} />}
          </Field>
          {(rf.kind === "percent_total" || (rf.kind === "item_discount" && rf.valueKind === "percent")) ? (
            <Field label={t("loyalty.maxDiscount")} error={rErrors.maxDiscount} hint={t("loyalty.maxHint")}>
              {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={rf.maxDiscount} onChange={(e) => setRf((f) => ({ ...f, maxDiscount: e.target.value }))} />}
            </Field>
          ) : null}
          <Field label={t("loyalty.minPurchase")} error={rErrors.minPurchase}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={rf.minPurchase} onChange={(e) => setRf((f) => ({ ...f, minPurchase: e.target.value }))} />}</Field>
          {rf.kind === "item_discount" ? (
            <Field label={t("loyalty.target")} error={rErrors.itemId}>
              {(id) => (
                <Select id={id} value={rf.target} onChange={(e) => setRf((f) => ({ ...f, target: e.target.value }))}>
                  <option value="">-</option>
                  <optgroup label={t("loyalty.items")}>{items.map((o) => <option key={o.id} value={`item:${o.id}`}>{o.name}</option>)}</optgroup>
                  <optgroup label={t("loyalty.categories")}>{cats.map((o) => <option key={o.id} value={`category:${o.id}`}>{o.name}</option>)}</optgroup>
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t("common.status")}>
            {(id) => (
              <Select id={id} value={rf.status} onChange={(e) => setRf((f) => ({ ...f, status: e.target.value as Reward["status"] }))}>
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.inactive")}</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        title={t("common.delete")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => void removeReward()}>{t("common.delete")}</Button>
          </>
        }
      >
        <p>{t("common.confirmDelete")}</p>
        <p className="font-medium">{deleting?.name}</p>
      </Modal>
    </div>
  );
}
