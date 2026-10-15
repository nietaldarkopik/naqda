"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { computeRefund } from "@naqdi/domain";
import { Badge, Button, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { posApi, PosError, type FloorMap, type OrderSummary, type OrderView } from "@/lib/posClient";
import type { Ctx } from "./PosApp";

export const FLOOR_COLS = 24;
export const FLOOR_ROWS = 14;

const errText = (e: unknown, fallback: string) => (e instanceof PosError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : fallback);

// ------------------------------------------------------------------ denah meja

export function TablesDialog({
  ctx,
  currentTableId,
  onLoaded,
  onClose,
  onPick,
  onOpenBill,
}: {
  ctx: Ctx;
  currentTableId: string | null | undefined;
  onLoaded: (floor: FloorMap) => void;
  onClose: () => void;
  onPick: (table: { id: string; name: string } | null) => void;
  onOpenBill: (orderId: string) => void;
}) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [floor, setFloor] = useState<FloorMap | null>(null);
  const [group, setGroup] = useState("all");
  const [picked, setPicked] = useState<FloorMap["tables"][number] | null>(null);
  const [bills, setBills] = useState<OrderSummary[] | null>(null);

  useEffect(() => {
    posApi<FloorMap>("/tables")
      .then((f) => {
        setFloor(f);
        onLoaded(f);
      })
      .catch((e) => toast(errText(e, t("network")), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (tb: FloorMap["tables"][number]) => {
    if (!tb.open) return onPick({ id: tb.id, name: tb.name });
    setPicked(tb);
    setBills(null);
    try {
      setBills((await posApi<{ items: OrderSummary[] }>(`/orders?status=open&tableId=${tb.id}`)).items);
    } catch (e) {
      toast(errText(e, t("network")), "error");
    }
  };

  const shown = (floor?.tables ?? []).filter((x) => group === "all" || x.groupId === group);

  return (
    <Modal open title={picked ? t("tableBills", { name: picked.name }) : t("tables")} onClose={onClose} wide>
      {picked ? (
        <div className="space-y-3">
          <ul className="divide-y divide-line rounded-lg border border-line">
            {bills === null ? <li className="p-6 text-center text-muted">{t("loading")}</li> : null}
            {bills?.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => onOpenBill(o.id)} className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-surface-2">
                  <span>
                    <span className="block font-medium">{o.label ?? t("unnamedBill")}</span>
                    <span className="block text-xs text-muted">{new Date(o.openedAt).toLocaleTimeString()}</span>
                  </span>
                  <span className="font-medium tabular-nums">{ctx.fmt(o.total)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setPicked(null)}>
              {t("back")}
            </Button>
            <Button onClick={() => onPick({ id: picked.id, name: picked.name })}>{t("newBillAtTable")}</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {[{ id: "all", name: t("all") }, ...(floor?.groups ?? [])].map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`h-8 rounded-full border px-3 text-sm ${group === g.id ? "border-brand bg-brand text-white" : "border-line hover:bg-surface-2"}`}
              >
                {g.name}
              </button>
            ))}
            {currentTableId ? (
              <Button variant="ghost" className="ms-auto" onClick={() => onPick(null)}>
                {t("noTable")}
              </Button>
            ) : null}
          </div>
          <div className="overflow-auto">
            <div className="relative min-w-[40rem] rounded-lg border border-line bg-surface-2" style={{ aspectRatio: `${FLOOR_COLS} / ${FLOOR_ROWS}` }} data-testid="pos-floor">
              {!floor ? <p className="absolute inset-0 grid place-items-center text-muted">{t("loading")}</p> : null}
              {floor && floor.tables.length === 0 ? <p className="absolute inset-0 grid place-items-center text-muted">{t("noTables")}</p> : null}
              {shown.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  data-testid={`pos-table-${tb.name}`}
                  onClick={() => void choose(tb)}
                  className={`absolute flex flex-col items-center justify-center border text-xs font-medium ${tb.shape === "round" ? "rounded-full" : "rounded-md"} ${
                    tb.open ? "border-amber-500 bg-warn-soft" : "border-brand bg-brand-soft"
                  } ${currentTableId === tb.id ? "ring-2 ring-ink" : ""}`}
                  style={{ left: `${(tb.x / FLOOR_COLS) * 100}%`, top: `${(tb.y / FLOOR_ROWS) * 100}%`, width: `${((tb.capacity > 4 ? 3 : 2) / FLOOR_COLS) * 100}%`, height: `${(1 / FLOOR_ROWS) * 100}%` }}
                >
                  <span className="max-w-full truncate px-1">{tb.name}</span>
                  {tb.open ? <span className="max-w-full truncate px-1 text-[10px] tabular-nums">{ctx.fmt(tb.open.total)}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted">{t("tablesLegend")}</p>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ persetujuan atasan

/** Kolom alasan + pilih atasan + PIN-nya. Dipakai bersama oleh pembatalan, hapus item, dan refund. */
export function ApprovalFields({
  ctx,
  privilege,
  needApproval,
  reason,
  onReason,
  approverId,
  onApprover,
  pin,
  onPin,
  error,
}: {
  ctx: Ctx;
  privilege: "pos.void" | "pos.refund";
  needApproval: boolean;
  reason: string;
  onReason: (v: string) => void;
  approverId: string;
  onApprover: (v: string) => void;
  pin: string;
  onPin: (v: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations("cashier");
  const [approvers, setApprovers] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    if (!needApproval) return;
    posApi<{ items: { id: string; name: string }[] }>(`/approvers?privilege=${privilege}`)
      .then((r) => {
        setApprovers(r.items);
        if (r.items[0]) onApprover(r.items[0].id);
      })
      .catch(() => setApprovers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needApproval, privilege]);

  void ctx;
  return (
    <div className="space-y-3">
      <Field label={t("reason")}>{(id) => <Input id={id} value={reason} maxLength={255} onChange={(e) => onReason(e.target.value)} autoFocus />}</Field>
      {needApproval ? (
        <fieldset className="space-y-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{t("approvalTitle")}</legend>
          <p className="text-xs text-muted">{t("approvalHelp")}</p>
          {approvers && approvers.length === 0 ? <p className="rounded bg-warn-soft p-2 text-sm">{t("noApprovers")}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("approver")}>
              {(id) => (
                <Select id={id} value={approverId} onChange={(e) => onApprover(e.target.value)}>
                  {approvers?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("approverPin")}>
              {(id) => (
                <Input id={id} type="password" inputMode="numeric" autoComplete="off" dir="ltr" className="text-start" maxLength={6} value={pin} onChange={(e) => onPin(e.target.value.replace(/\D/g, ""))} invalid={Boolean(error)} />
              )}
            </Field>
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface ApprovalInput {
  reason: string;
  approval: { userId: string; pin: string } | null;
}

export function ApprovalDialog({
  ctx,
  privilege,
  title,
  onRun,
  onClose,
}: {
  ctx: Ctx;
  privilege: "pos.void" | "pos.refund";
  title: string;
  /** Menjalankan permintaan sebenarnya; mengembalikan teks galat, atau null bila berhasil. */
  onRun: (input: ApprovalInput) => Promise<string | null>;
  onClose: (done: boolean) => void;
}) {
  const t = useTranslations("cashier");
  const needApproval = !ctx.can(privilege);
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length > 0 && (!needApproval || (approverId && pin.length >= 4));

  const submit = async () => {
    setBusy(true);
    setError("");
    const err = await onRun({ reason: reason.trim(), approval: needApproval ? { userId: approverId, pin } : null });
    setBusy(false);
    if (err) {
      setError(err);
      setPin("");
    } else onClose(true);
  };

  return (
    <Modal
      open
      title={title}
      onClose={() => onClose(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="danger" disabled={!ready || busy} onClick={() => void submit()} data-testid="approval-confirm">
            {t("confirm")}
          </Button>
        </>
      }
    >
      <ApprovalFields ctx={ctx} privilege={privilege} needApproval={needApproval} reason={reason} onReason={setReason} approverId={approverId} onApprover={setApproverId} pin={pin} onPin={setPin} error={error} />
    </Modal>
  );
}

// ------------------------------------------------------------------ refund

export function RefundDialog({ ctx, order, onClose, onDone }: { ctx: Ctx; order: OrderView; onClose: () => void; onDone: (o: OrderView) => void }) {
  const t = useTranslations("cashier");
  const locale = useLocale();
  void locale;
  const toast = useToast();
  const methods = useMemo(() => [...new Set(order.payments.map((p) => p.method))], [order.payments]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState(methods[0] ?? "cash");
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needApproval = !ctx.can("pos.refund");

  const selection = Object.entries(qty).filter(([, q]) => q > 0).map(([lineId, quantity]) => ({ lineId, quantity }));
  const estimate = useMemo(() => {
    if (selection.length === 0) return 0;
    try {
      return computeRefund(
        order.totals.total,
        order.lines.map((l) => ({ id: l.id, weight: Math.max(0, l.unitPrice * l.quantity - l.lineDiscount - l.promoDiscount - l.orderDiscountShare), quantity: l.quantity, refundedQuantity: l.refundedQuantity })),
        selection,
      ).total;
    } catch {
      return 0;
    }
  }, [order, selection]);

  const remainingOf = (l: OrderView["lines"][number]) => l.quantity - l.refundedQuantity;
  const allSelected = () => setQty(Object.fromEntries(order.lines.map((l) => [l.id, remainingOf(l)])));
  const ready = selection.length > 0 && reason.trim().length > 0 && (!needApproval || (approverId && pin.length >= 4));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await posApi<{ order: OrderView; refund: { total: number } }>(`/orders/${order.id}/refund`, {
        method: "POST",
        json: { lines: selection, method, reason: reason.trim(), approval: needApproval ? { userId: approverId, pin } : null },
      });
      toast(t("refundDone", { amount: ctx.fmt(res.refund.total) }));
      onDone(res.order);
    } catch (e) {
      setError(errText(e, t("network")));
      setPin("");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("refundTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="danger" disabled={!ready || busy} onClick={() => void submit()} data-testid="refund-confirm">
            {t("refundConfirm")} · {ctx.fmt(estimate)}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{t("refundHelp")}</p>
        <Button variant="ghost" onClick={allSelected}>
          {t("refundAll")}
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {order.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate font-medium">{l.name}</span>
              <span className="block text-xs text-muted">
                {remainingOf(l)}/{l.quantity} {t("refundable")} {l.refundedQuantity > 0 ? <Badge tone="warn">{t("refundedQty", { count: l.refundedQuantity })}</Badge> : null}
              </span>
            </span>
            <span className="flex items-center gap-1" dir="ltr">
              <Button variant="secondary" className="h-9 w-9" aria-label={t("decrease")} onClick={() => setQty((q) => ({ ...q, [l.id]: Math.max(0, (q[l.id] ?? 0) - 1) }))}>
                −
              </Button>
              <span className="w-12 text-center tabular-nums">
                {qty[l.id] ?? 0}/{remainingOf(l)}
              </span>
              <Button variant="secondary" className="h-9 w-9" aria-label={t("increase")} disabled={remainingOf(l) === 0} onClick={() => setQty((q) => ({ ...q, [l.id]: Math.min(remainingOf(l), (q[l.id] ?? 0) + 1) }))}>
                +
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <Field label={t("refundMethod")} hint={method === "cash" ? t("refundCashHint") : undefined}>
        {(id) => (
          <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {t(`methods.${m}` as never)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ApprovalFields ctx={ctx} privilege="pos.refund" needApproval={needApproval} reason={reason} onReason={setReason} approverId={approverId} onApprover={setApproverId} pin={pin} onPin={setPin} error={error} />
    </Modal>
  );
}

export type { OrderSummary };
