"use client";

import { Frown, Smile } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge, Button, Field, Input, Modal, useToast } from "@/components/ui";
import { posApi, PosError, type OrderView, type PosCustomer, type PosLoyalty, type PosReward } from "@/lib/posClient";
import type { Ctx } from "./PosApp";

const errText = (e: unknown, fallback: string) => (e instanceof PosError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : fallback);

// ------------------------------------------------------------------ pilih atau daftarkan pelanggan

export function CustomerDialog({ onClose, onPick, loyaltyOn }: { onClose: () => void; onPick: (c: PosCustomer | null) => void; loyaltyOn: boolean }) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosCustomer[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", enroll: true });
  const [error, setError] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      posApi<{ items: PosCustomer[] }>(`/customers?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.items))
        .catch((e) => toast(errText(e, t("network")), "error"));
    }, 200);
    return () => clearTimeout(id);
  }, [q, toast, t]);

  const create = async () => {
    setError("");
    try {
      const res = await posApi<{ customer: PosCustomer }>("/customers", { method: "POST", json: { name: form.name, phone: form.phone || null, enroll: loyaltyOn && form.enroll } });
      onPick(res.customer);
    } catch (e) {
      setError(errText(e, t("network")));
    }
  };

  return (
    <Modal open title={adding ? t("newCustomer") : t("customer")} onClose={onClose}>
      {adding ? (
        <div className="space-y-3">
          <Field label={t("customerName")}>{(id) => <Input id={id} value={form.name} maxLength={191} autoFocus onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
          <Field label={t("customerPhone")} hint={t("customerPhoneHint")}>{(id) => <Input id={id} dir="ltr" inputMode="tel" className="text-start" value={form.phone} maxLength={32} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}</Field>
          {loyaltyOn ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enroll} onChange={(e) => setForm((f) => ({ ...f, enroll: e.target.checked }))} data-testid="customer-enroll" />
              {t("enrollMember")}
            </label>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>{t("back")}</Button>
            <Button disabled={!form.name.trim()} onClick={() => void create()} data-testid="customer-create">{t("save")}</Button>
          </div>
        </div>
      ) : (
        <>
          <Input type="search" autoFocus placeholder={t("searchCustomer")} aria-label={t("searchCustomer")} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {results?.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onPick(c)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-surface-2">
                  <span>
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-xs text-muted"><span className="ltr-text">{c.phone ?? "-"}</span></span>
                  </span>
                  {c.member ? <Badge tone="good">{t("pointsLabel", { count: c.points })}</Badge> : <Badge>{t("notMember")}</Badge>}
                </button>
              </li>
            ))}
            {results && results.length === 0 ? <li className="p-6 text-center text-muted">{t("noCustomers")}</li> : null}
          </ul>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => onPick(null)}>{t("noCustomer")}</Button>
            <Button onClick={() => setAdding(true)} data-testid="customer-new">{t("newCustomer")}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ pilih reward (dan kode validasi)

export function RewardDialog({
  ctx,
  customer,
  loyalty,
  currentRewardId,
  onClose,
  onPick,
}: {
  ctx: Ctx;
  customer: PosCustomer;
  loyalty: PosLoyalty;
  currentRewardId: string | null | undefined;
  onClose: () => void;
  onPick: (reward: PosReward | null, code: string | null) => void;
}) {
  const t = useTranslations("cashier");
  const tx = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const [picked, setPicked] = useState<PosReward | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);
  const [error, setError] = useState("");

  const describe = (r: PosReward) => {
    const v = r.valueKind === "percent" ? `${r.value / 100}%` : ctx.fmt(r.value);
    return `${tx(`rewardKinds.${r.kind}`)} · ${v}${r.minPurchase > 0 ? ` · ${t("minPurchase", { amount: ctx.fmt(r.minPurchase) })}` : ""}`;
  };

  const requestCode = async (r: PosReward) => {
    setError("");
    try {
      setSent(await posApi<{ devCode?: string }>("/loyalty/code", { method: "POST", json: { customerId: customer.id, rewardId: r.id } }));
    } catch (e) {
      setError(errText(e, t("network")));
    }
  };

  const choose = (r: PosReward) => {
    if (!loyalty.requireCode) return onPick(r, null);
    setPicked(r);
    setSent(null);
    setCode("");
    void requestCode(r);
  };

  return (
    <Modal open title={t("reward")} onClose={onClose}>
      <p className="text-sm text-muted">{customer.name} · {t("pointsLabel", { count: customer.points })}</p>
      {picked ? (
        <div className="space-y-3">
          <p className="font-medium">{picked.name}</p>
          <p className="text-sm text-muted">{t("codeSentHelp")}</p>
          {sent?.devCode ? <p className="rounded bg-warn-soft p-2 text-sm" data-testid="dev-code">{t("devCode")}: <span className="font-mono font-semibold">{sent.devCode}</span></p> : null}
          <Field label={t("validationCode")}>{(id) => <Input id={id} inputMode="numeric" dir="ltr" autoFocus className="text-start font-mono text-lg tracking-widest" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}</Field>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setPicked(null)}>{t("back")}</Button>
            <Button variant="ghost" onClick={() => void requestCode(picked)}>{t("resendCode")}</Button>
            <Button disabled={code.length !== 6} onClick={() => onPick(picked, code)} data-testid="reward-code-ok">{t("apply")}</Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {loyalty.rewards.map((r) => {
              const enough = customer.points >= r.pointsCost;
              return (
                <li key={r.id}>
                  <button type="button" disabled={!enough} onClick={() => choose(r)} data-testid={`reward-${r.name}`} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-start ${enough ? "hover:bg-surface-2" : "opacity-50"} ${currentRewardId === r.id ? "bg-brand-soft" : ""}`}>
                    <span>
                      <span className="block font-medium">{r.name}</span>
                      <span className="block text-xs text-muted">{describe(r)}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{t("pointsLabel", { count: r.pointsCost })}</span>
                  </button>
                </li>
              );
            })}
            {loyalty.rewards.length === 0 ? <li className="p-6 text-center text-muted">{t("noRewards")}</li> : null}
          </ul>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          {currentRewardId ? <Button variant="ghost" className="text-danger" onClick={() => onPick(null, null)}>{t("removeReward")}</Button> : null}
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ feedback pada struk

export function FeedbackPanel({ order }: { order: OrderView }) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [done, setDone] = useState(false);
  const [comment, setComment] = useState("");
  const send = async (rating: "good" | "bad") => {
    try {
      await posApi("/feedback", { method: "POST", json: { orderId: order.id, customerId: order.customerId, rating, comment: comment.trim() || null } });
      setDone(true);
    } catch (e) {
      toast(errText(e, t("network")), "error");
    }
  };
  if (done) return <p className="text-center text-sm text-muted" data-testid="feedback-done">{t("feedbackThanks")}</p>;
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="text-sm font-medium">{t("feedbackTitle")}</div>
      <Input aria-label={t("feedbackComment")} placeholder={t("feedbackComment")} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => void send("good")} data-testid="feedback-good">
          <Smile size={16} aria-hidden /> {t("feedbackGood")}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => void send("bad")} data-testid="feedback-bad">
          <Frown size={16} aria-hidden /> {t("feedbackBad")}
        </Button>
      </div>
    </div>
  );
}
