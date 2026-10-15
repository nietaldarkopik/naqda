"use client";

import { Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { quickCashAmounts } from "@naqdi/domain";
import { Badge, Button, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { parseMajor } from "@/lib/money";
import {
  posApi,
  PosError,
  type CartLine,
  type CatalogItem,
  type DiscountPick,
  type OrderSummary,
  type OrderView,
  type PosDiscount,
  type PosSettings,
  type ShiftView,
} from "@/lib/posClient";
import type { Ctx } from "./PosApp";
import { FeedbackPanel } from "./dialogs3";
import { ReceiptView, defaultReceiptSettings, type ReceiptData } from "@/components/ReceiptView";

const errText = (e: unknown, fallback: string) => (e instanceof PosError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : fallback);

// ------------------------------------------------------------------ item: varian, modifier, catatan, jumlah

export function ItemDialog({
  ctx,
  item,
  salesTypeId,
  initial,
  onClose,
  onConfirm,
}: {
  ctx: Ctx;
  item: CatalogItem;
  salesTypeId: string;
  initial?: CartLine | undefined;
  onClose: () => void;
  onConfirm: (line: CartLine) => void;
}) {
  const t = useTranslations("cashier");
  const init = initial?.kind === "item" ? initial : undefined;
  const [variantId, setVariantId] = useState(init?.variantId ?? item.variants[0]!.id);
  const [picked, setPicked] = useState<string[]>(init?.modifierOptionIds ?? []);
  const [quantity, setQuantity] = useState(init?.quantity ?? 1);
  const [note, setNote] = useState(init?.note ?? "");

  const toggle = (setId: string, optionId: string, max: number | null) => {
    const set = item.modifierSets.find((s) => s.id === setId)!;
    const ids = new Set(set.options.map((o) => o.id));
    setPicked((cur) => {
      if (cur.includes(optionId)) return cur.filter((x) => x !== optionId);
      const inSet = cur.filter((x) => ids.has(x));
      if (max === 1) return [...cur.filter((x) => !ids.has(x)), optionId]; // pilihan tunggal: ganti
      if (max !== null && inSet.length >= max) return cur;
      return [...cur, optionId];
    });
  };

  const missing = item.modifierSets.find((s) => picked.filter((id) => s.options.some((o) => o.id === id)).length < s.minSelect);
  const variant = item.variants.find((v) => v.id === variantId)!;
  const unit = (variant.prices[salesTypeId] ?? variant.basePrice) + item.modifierSets.flatMap((s) => s.options).filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.price, 0);

  return (
    <Modal
      open
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={Boolean(missing)}
            onClick={() => onConfirm({ kind: "item", variantId, quantity, modifierOptionIds: picked, note: note.trim() || null, discount: init?.discount ?? null })}
          >
            {init ? t("update") : t("addToCart")} · {ctx.fmt(unit * quantity)}
          </Button>
        </>
      }
    >
      {item.variants.length > 1 ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">{t("variant")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.variants.map((v) => (
              <label key={v.id} className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 ${variantId === v.id ? "border-brand bg-brand-soft" : "border-line"}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                  {v.name}
                </span>
                <span className="text-sm text-muted tabular-nums">{ctx.fmt(v.prices[salesTypeId] ?? v.basePrice)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {item.modifierSets.map((s) => (
        <fieldset key={s.id} className="space-y-1.5">
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
            <span>{s.name}</span>
            <span className="text-xs font-normal text-muted">
              {s.minSelect > 0 ? t("required") : t("optional")}
              {s.maxSelect ? ` · ${t("maxChoices", { count: s.maxSelect })}` : ""}
            </span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {s.options.map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 ${picked.includes(o.id) ? "border-brand bg-brand-soft" : "border-line"}`}>
                <span className="flex items-center gap-2">
                  <input type={s.maxSelect === 1 ? "radio" : "checkbox"} name={s.id} checked={picked.includes(o.id)} onChange={() => toggle(s.id, o.id, s.maxSelect)} />
                  {o.name}
                </span>
                {o.price ? <span className="text-sm text-muted tabular-nums">+{ctx.fmt(o.price)}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {missing ? <p className="text-sm text-danger">{t("chooseRequired", { name: missing.name })}</p> : null}

      <Field label={t("note")}>{(id) => <Input id={id} value={note ?? ""} maxLength={255} onChange={(e) => setNote(e.target.value)} />}</Field>

      <div className="flex items-center justify-between" dir="ltr">
        <span className="text-sm font-medium">{t("quantity")}</span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="h-10 w-10" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label={t("decrease")}>
            −
          </Button>
          <span className="w-10 text-center text-lg font-semibold tabular-nums">{quantity}</span>
          <Button variant="secondary" className="h-10 w-10" onClick={() => setQuantity((q) => Math.min(9999, q + 1))} aria-label={t("increase")}>
            +
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ diskon

export function DiscountDialog({
  ctx,
  discounts,
  current,
  onClose,
  onPick,
}: {
  ctx: Ctx;
  discounts: PosDiscount[];
  current: DiscountPick | null | undefined;
  onClose: () => void;
  onPick: (pick: DiscountPick | null) => void;
}) {
  const t = useTranslations("cashier");
  const [selected, setSelected] = useState<string>(current?.discountId ?? "");
  const d = discounts.find((x) => x.id === selected);
  const [value, setValue] = useState(() => {
    if (!current || !d) return "";
    return current.value === undefined ? "" : d.kind === "percent" ? String(current.value / 100) : String(current.value / 10 ** ctx.exponent);
  });
  const [error, setError] = useState("");

  const confirm = () => {
    if (!d) return;
    if (!d.customizable || value.trim() === "") return onPick({ discountId: d.id });
    const minor = d.kind === "percent" ? Math.round(Number(value.replace(",", ".")) * 100) : parseMajor(value, ctx.exponent);
    if (minor === null || !Number.isFinite(minor) || minor < 0 || (d.kind === "percent" && minor > 10_000)) return setError(t("invalidAmount"));
    onPick({ discountId: d.id, value: minor });
  };

  return (
    <Modal
      open
      title={t("chooseDiscount")}
      onClose={onClose}
      footer={
        <>
          {current ? (
            <Button variant="ghost" className="me-auto text-danger" onClick={() => onPick(null)}>
              {t("removeDiscount")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!d} onClick={confirm}>
            {t("apply")}
          </Button>
        </>
      }
    >
      {discounts.length === 0 ? <p className="text-muted">{t("noDiscounts")}</p> : null}
      <div className="grid gap-2">
        {discounts.map((x) => (
          <label key={x.id} className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 ${selected === x.id ? "border-brand bg-brand-soft" : "border-line"}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name="discount" checked={selected === x.id} onChange={() => { setSelected(x.id); setValue(""); setError(""); }} />
              {x.name}
            </span>
            <span className="text-sm text-muted tabular-nums">{x.kind === "percent" ? `${x.value / 100}%` : ctx.fmt(x.value)}</span>
          </label>
        ))}
      </div>
      {d?.customizable ? (
        <Field label={d.kind === "percent" ? t("customPercent") : t("customAmount")} error={error || undefined} hint={t("customHint")}>
          {(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={value} onChange={(e) => setValue(e.target.value)} invalid={Boolean(error)} />}
        </Field>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ bayar

type Method = string;
interface PayRow {
  method: Method;
  amount: string;
  reference: string;
}

export function PayDialog({
  ctx,
  total,
  methods,
  allowSplit,
  onClose,
  onPay,
}: {
  ctx: Ctx;
  total: number;
  methods: { key: string; name: string | null }[];
  allowSplit: boolean;
  onClose: () => void;
  onPay: (payments: { method: string; amount: number; reference?: string | null }[], stockOverride?: boolean) => Promise<boolean>;
}) {
  const t = useTranslations("cashier");
  const unit = 10 ** ctx.exponent;
  const [rows, setRows] = useState<PayRow[]>([{ method: "cash", amount: "", reference: "" }]);
  const [busy, setBusy] = useState(false);

  const parsed = rows.map((r) => ({ ...r, minor: r.amount.trim() === "" ? 0 : parseMajor(r.amount, ctx.exponent) }));
  const invalid = parsed.some((r) => r.minor === null);
  const sum = parsed.reduce((a, r) => a + (r.minor ?? 0), 0);
  const nonCash = parsed.filter((r) => r.method !== "cash").reduce((a, r) => a + (r.minor ?? 0), 0);
  const cashIn = parsed.filter((r) => r.method === "cash").reduce((a, r) => a + (r.minor ?? 0), 0);
  const remaining = Math.max(0, total - sum);
  const change = cashIn > 0 ? Math.max(0, sum - total) : 0;
  const nonCashOver = nonCash > total;
  const ready = !invalid && sum >= total && !nonCashOver && (total === 0 || sum > 0) && (change === 0 || cashIn >= change);

  // Saran uang tunai: pecahan umum mata uang bisnis ini (bukan rupiah tertanam), jadi benar juga untuk toko berdesimal.
  const currency = ctx.session.business.currency;
  const quick = useMemo(() => quickCashAmounts(total, currency, ctx.exponent), [total, currency, ctx.exponent]);

  const setRow = (i: number, patch: Partial<PayRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const fillRemaining = (i: number) => {
    const others = parsed.reduce((a, r, j) => a + (j === i ? 0 : (r.minor ?? 0)), 0);
    setRow(i, { amount: String(Math.max(0, total - others) / unit) });
  };

  const submit = async () => {
    setBusy(true);
    const payments = parsed
      .filter((r) => (r.minor ?? 0) > 0)
      .map((r) => ({ method: r.method, amount: r.minor!, reference: r.reference.trim() || null }));
    const ok = await onPay(payments);
    if (!ok) setBusy(false);
  };

  return (
    <Modal
      open
      title={t("payment")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button disabled={!ready || busy} onClick={() => void submit()} data-testid="confirm-pay">
            {t("completePayment")}
          </Button>
        </>
      }
    >
      <div className="rounded-xl bg-surface-2 p-4 text-center">
        <div className="text-sm text-muted">{t("amountDue")}</div>
        <div className="text-3xl font-semibold tabular-nums" data-testid="amount-due">
          {ctx.fmt(total)}
        </div>
      </div>

      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line p-3">
          <div className="flex gap-2">
            <Select aria-label={t("method")} value={r.method} onChange={(e) => setRow(i, { method: e.target.value as Method })} className="w-40">
              {methods.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name ?? t(`methods.${m.key}` as never)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("amount")}
              inputMode="decimal"
              dir="ltr"
              className="text-start text-lg"
              value={r.amount}
              placeholder="0"
              onChange={(e) => setRow(i, { amount: e.target.value })}
              invalid={parsed[i]!.minor === null}
            />
            <Button variant="secondary" onClick={() => fillRemaining(i)}>
              {t("exact")}
            </Button>
            {rows.length > 1 ? (
              <Button variant="ghost" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label={t("remove")}>
                ✕
              </Button>
            ) : null}
          </div>
          {r.method === "cash" ? (
            <div className="flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button key={q} type="button" onClick={() => setRow(i, { amount: String(q / unit) })} className="rounded-full border border-line px-3 py-1 text-sm tabular-nums hover:bg-surface-2">
                  {ctx.fmt(q)}
                </button>
              ))}
            </div>
          ) : (
            <Input aria-label={t("reference")} placeholder={t("reference")} value={r.reference} maxLength={120} onChange={(e) => setRow(i, { reference: e.target.value })} />
          )}
        </div>
      ))}
      {allowSplit && rows.length < 4 ? (
        <Button variant="ghost" onClick={() => setRows((cur) => [...cur, { method: "card", amount: "", reference: "" }])}>
          + {t("splitPayment")}
        </Button>
      ) : null}

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">{t("remaining")}</span>
          <span className="tabular-nums" data-testid="remaining">{ctx.fmt(remaining)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <span>{t("change")}</span>
          <span className="tabular-nums" data-testid="change">{ctx.fmt(change)}</span>
        </div>
        {nonCashOver ? <p className="text-danger">{t("nonCashOver")}</p> : null}
        {change > cashIn && cashIn > 0 ? <p className="text-danger">{t("changeNeedsCash")}</p> : null}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ daftar bill

export function BillsDialog({ ctx, onClose, onOpen }: { ctx: Ctx; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [tab, setTab] = useState<"open" | "paid">("open");
  const [items, setItems] = useState<OrderSummary[] | null>(null);

  useEffect(() => {
    setItems(null);
    posApi<{ items: OrderSummary[] }>(`/orders?status=${tab}&limit=50`)
      .then((r) => setItems(r.items))
      .catch((e) => toast(errText(e, t("network")), "error"));
  }, [tab, toast, t]);

  return (
    <Modal open title={t("bills")} onClose={onClose}>
      <div className="flex gap-2" role="tablist">
        {(["open", "paid"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 rounded-full border px-4 text-sm font-medium ${tab === k ? "border-brand bg-brand text-white" : "border-line hover:bg-surface-2"}`}>
            {t(k === "open" ? "openBills" : "paidBills")}
          </button>
        ))}
      </div>
      <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {items === null ? <li className="p-6 text-center text-muted">{t("loading")}</li> : null}
        {items?.length === 0 ? <li className="p-6 text-center text-muted">{t("noBills")}</li> : null}
        {items?.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => onOpen(o.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-2">
              <span>
                <span className="block font-medium">
                  {o.receiptNumber ? `#${o.receiptNumber}` : (o.label ?? t("unnamedBill"))}
                  {o.tableName ? <span className="ms-2 text-xs font-normal text-muted">{o.tableName}</span> : null}
                  {o.refundedTotal ? <Badge tone="warn">{t("refunded")}</Badge> : null}
                </span>
                <span className="block text-xs text-muted">{new Date(o.openedAt).toLocaleString()}</span>
              </span>
              <span className="font-medium tabular-nums">{ctx.fmt(o.total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ------------------------------------------------------------------ pisah bill

export function SplitDialog({ ctx, order, onClose, onDone }: { ctx: Ctx; order: OrderView; onClose: () => void; onDone: (kept: OrderView) => void }) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const selection = Object.entries(qty).filter(([, q]) => q > 0).map(([lineId, quantity]) => ({ lineId, quantity }));
  const movedAll = order.lines.every((l) => (qty[l.id] ?? 0) === l.quantity);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await posApi<{ order: OrderView }>(`/orders/${order.id}/split`, { method: "POST", json: { selection } });
      onDone(res.order);
    } catch (e) {
      toast(errText(e, t("network")), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("splitTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={busy || selection.length === 0 || movedAll} onClick={() => void submit()}>
            {t("splitConfirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{t("splitHelp")}</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {order.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate font-medium">{l.name}</span>
              <span className="block text-xs text-muted">
                {l.quantity} × {ctx.fmt(l.unitPrice)}
              </span>
            </span>
            <span className="flex items-center gap-1" dir="ltr">
              <Button variant="secondary" className="h-9 w-9" aria-label={t("decrease")} onClick={() => setQty((q) => ({ ...q, [l.id]: Math.max(0, (q[l.id] ?? 0) - 1) }))}>
                −
              </Button>
              <span className="w-12 text-center tabular-nums">
                {qty[l.id] ?? 0}/{l.quantity}
              </span>
              <Button variant="secondary" className="h-9 w-9" aria-label={t("increase")} onClick={() => setQty((q) => ({ ...q, [l.id]: Math.min(l.quantity, (q[l.id] ?? 0) + 1) }))}>
                +
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {movedAll ? <p className="text-sm text-danger">{t("splitNotAll")}</p> : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ shift dan kas

export function ShiftDialog({
  ctx,
  shift,
  onShift,
  onClose,
  onClosed,
}: {
  ctx: Ctx;
  shift: ShiftView;
  onShift: (s: ShiftView) => void;
  onClose: () => void;
  onClosed: () => void;
}) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [view, setView] = useState<ShiftView>(shift);
  const [mode, setMode] = useState<"summary" | "move" | "close" | "closed">("summary");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manage = ctx.can("shift.manage");

  useEffect(() => {
    posApi<{ shift: ShiftView | null }>("/shifts/current")
      .then((r) => r.shift && setView(r.shift))
      .catch(() => undefined);
  }, []);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e, t("network")));
    } finally {
      setBusy(false);
    }
  };

  const money = () => parseMajor(amount, ctx.exponent);

  const submitMove = () =>
    act(async () => {
      const m = money();
      if (!m || m <= 0 || !text.trim()) throw new PosError(0, "validation", t("invalidAmount"));
      const res = await posApi<{ shift: ShiftView }>("/shifts/cash", { method: "POST", json: { kind, amount: m, description: text.trim() } });
      setView(res.shift);
      onShift(res.shift);
      setMode("summary");
      setAmount("");
      setText("");
      toast(t("saved"));
    });

  const submitClose = () =>
    act(async () => {
      const m = parseMajor(amount || "0", ctx.exponent);
      if (m === null) throw new PosError(0, "validation", t("invalidAmount"));
      const res = await posApi<{ shift: ShiftView }>("/shifts/close", { method: "POST", json: { actualCash: m, note: text.trim() || null } });
      setView(res.shift);
      setMode("closed");
    });

  const diff = view.difference ?? 0;

  return (
    <Modal open title={t("shift")} onClose={mode === "closed" ? onClosed : onClose}>
      {mode === "closed" ? (
        <div className="space-y-3 text-center">
          <h3 className="text-lg font-semibold">{t("shiftClosed")}</h3>
          <Summary ctx={ctx} view={view} />
          <p className={`text-lg font-semibold ${diff === 0 ? "" : "text-danger"}`}>
            {t("difference")}: {diff > 0 ? "+" : ""}
            {ctx.fmt(diff)}
          </p>
          <Button className="w-full" onClick={onClosed}>
            {t("done")}
          </Button>
        </div>
      ) : (
        <>
          <Summary ctx={ctx} view={view} />
          {view.movements.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {view.movements.map((m) => (
                <li key={m.id} className="flex justify-between px-3 py-2">
                  <span>{m.description}</span>
                  <span className={`tabular-nums ${m.kind === "out" ? "text-danger" : ""}`}>
                    {m.kind === "out" ? "−" : "+"}
                    {ctx.fmt(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {mode === "summary" && manage ? (
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" onClick={() => { setKind("in"); setMode("move"); setAmount(""); setText(""); setError(""); }}>
                {t("cashIn")}
              </Button>
              <Button variant="secondary" onClick={() => { setKind("out"); setMode("move"); setAmount(""); setText(""); setError(""); }}>
                {t("cashOut")}
              </Button>
              <Button variant="danger" onClick={() => { setMode("close"); setAmount(""); setText(""); setError(""); }}>
                {t("closeShift")}
              </Button>
            </div>
          ) : null}

          {mode === "move" ? (
            <div className="space-y-3">
              <Field label={kind === "in" ? t("cashIn") : t("cashOut")}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
              <Field label={t("description")}>{(id) => <Input id={id} value={text} maxLength={255} onChange={(e) => setText(e.target.value)} />}</Field>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode("summary")}>{t("cancel")}</Button>
                <Button disabled={busy} onClick={() => void submitMove()}>{t("save")}</Button>
              </div>
            </div>
          ) : null}

          {mode === "close" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t("closeHelp")}</p>
              <Field label={t("countedCash")}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" className="text-start text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
              <Field label={t("note")}>{(id) => <Input id={id} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />}</Field>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode("summary")}>{t("cancel")}</Button>
                <Button variant="danger" disabled={busy} onClick={() => void submitClose()}>{t("closeShift")}</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}

function Summary({ ctx, view }: { ctx: Ctx; view: ShiftView }) {
  const t = useTranslations("cashier");
  const rows: [string, number | null][] = [
    [t("openingCash"), view.openingCash],
    [t("cashSales"), view.cashSales],
    [t("nonCashSales"), view.nonCashSales],
    [t("cashIn"), view.cashIn],
    [t("cashOut"), -view.cashOut],
    [t("cashRefunds"), -view.cashRefunds],
    [t("expectedCash"), view.expectedCash],
  ];
  return (
    <dl className="space-y-1 rounded-lg bg-surface-2 p-3 text-sm">
      {rows.map(([k, v], i) => (
        <div key={k} className={`flex justify-between ${i === rows.length - 1 ? "border-t border-line pt-1 font-semibold" : ""}`}>
          <dt className="text-muted">{k}</dt>
          <dd className="tabular-nums">{v === null ? "-" : ctx.fmt(v)}</dd>
        </div>
      ))}
      <div className="flex justify-between text-muted">
        <dt>{t("orderCount")}</dt>
        <dd className="tabular-nums">{view.orderCount}</dd>
      </div>
    </dl>
  );
}

// ------------------------------------------------------------------ struk

export function ReceiptDialog({
  ctx,
  order,
  settings,
  tableName,
  onClose,
  onRefund,
}: {
  ctx: Ctx;
  order: OrderView;
  settings: PosSettings | null;
  tableName?: string | null;
  onClose: () => void;
  onRefund?: (() => void) | undefined;
}) {
  const t = useTranslations("cashier");
  const to = useTranslations("offline");
  const tx = t as unknown as (k: string) => string;
  const snap = order.snapshot;
  const paid = order.status === "paid";
  const provisional = Boolean(order.offlineRef);
  const label = (key: string) => settings?.paymentMethods.find((m) => m.key === key)?.name ?? (["cash", "card", "qris", "ewallet", "transfer", "other"].includes(key) ? tx(`methods.${key}`) : key);
  const data: ReceiptData = {
    businessName: ctx.session.business.name,
    outlet: settings?.outlet ?? { name: ctx.session.outlet.name, address: null, phone: null },
    receiptNumber: order.receiptNumber,
    provisionalRef: order.offlineRef ?? null,
    at: order.paidAt ?? order.openedAt,
    cashier: ctx.session.user.name,
    table: tableName ?? null,
    lines: order.lines.map((l) => ({ id: l.id, quantity: l.quantity, name: l.name, unitPrice: l.unitPrice, modifiers: l.modifiers.map((m) => m.name), discount: l.lineDiscount + l.promoDiscount })),
    subtotal: order.totals.subtotal,
    discountTotal: order.totals.discountTotal,
    charges: [...(snap?.gratuities ?? []).map((g) => ({ name: g.name, amount: g.amount, kind: "gratuity" as const })), ...(snap?.taxes ?? []).map((x) => ({ name: x.name, amount: x.amount, kind: "tax" as const }))],
    rounding: order.totals.rounding,
    total: order.totals.total,
    payments: order.payments.map((p) => ({ label: label(p.method), amount: p.tendered })),
    change: order.totals.change,
    refunded: order.refundedTotal,
    customer: order.customer,
    pointsRedeemed: order.pointsRedeemed,
    pointsEarned: order.pointsEarned,
    paid,
  };
  return (
    <Modal
      open
      title={provisional ? to("receiptTitle") : paid ? t("paymentDone") : t("receipt")}
      onClose={onClose}
      footer={
        <>
          {paid && !provisional && order.refundedTotal < order.totals.total && onRefund ? (
            <Button variant="secondary" onClick={onRefund} data-testid="open-refund">
              {t("refund")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} aria-hidden /> {t("print")}
          </Button>
          <Button onClick={onClose} data-testid="receipt-close">
            {t("done")}
          </Button>
        </>
      }
    >
      {paid && order.totals.change > 0 ? (
        <div className="rounded-xl bg-brand-soft p-3 text-center">
          <div className="text-sm text-muted">{t("change")}</div>
          <div className="text-2xl font-semibold tabular-nums" data-testid="receipt-change">
            {ctx.fmt(order.totals.change)}
          </div>
        </div>
      ) : null}
      {provisional ? (
        <p role="status" className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="offline-receipt-note">
          {to("receiptNote")}
        </p>
      ) : null}
      {paid && !provisional ? <FeedbackPanel order={order} /> : null}
      <ReceiptView data={data} settings={settings?.receipt ?? defaultReceiptSettings} fmt={ctx.fmt} />
    </Modal>
  );
}
