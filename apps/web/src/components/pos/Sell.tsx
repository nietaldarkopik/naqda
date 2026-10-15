"use client";

import { ClipboardList, LayoutGrid, LogOut, Minus, Percent, Plus, Search, Split, Trash2, Wallet, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select, useToast } from "@/components/ui";
import {
  cartFromOrder,
  posApi,
  PosError,
  type Cart,
  type CartLine,
  type Catalog,
  type CatalogItem,
  type DiscountPick,
  type FloorMap,
  type OrderView,
  type PosCustomer,
  type PosLoyalty,
  type PosReward,
  type PriceResult,
  type ShiftView,
} from "@/lib/posClient";
import type { Ctx } from "./PosApp";
import { BillsDialog, DiscountDialog, ItemDialog, PayDialog, ReceiptDialog, ShiftDialog, SplitDialog } from "./dialogs";
import { ApprovalDialog, RefundDialog, TablesDialog, type ApprovalInput } from "./dialogs2";
import { CustomerDialog, RewardDialog } from "./dialogs3";

const sameLine = (a: CartLine, b: CartLine): boolean => {
  if (a.kind !== b.kind || a.note || b.note || a.discount || b.discount) return false;
  if (a.kind === "bundle" && b.kind === "bundle") return a.bundleId === b.bundleId;
  if (a.kind === "item" && b.kind === "item") return a.variantId === b.variantId && [...a.modifierOptionIds].sort().join() === [...b.modifierOptionIds].sort().join();
  return false;
};

export function Sell({
  ctx,
  shift,
  onShift,
  onShiftClosed,
  onLogout,
}: {
  ctx: Ctx;
  shift: ShiftView;
  onShift: (s: ShiftView) => void;
  onShiftClosed: () => void;
  onLogout: () => void;
}) {
  const t = useTranslations("cashier");
  const toast = useToast();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Cart>({ salesTypeId: "", lines: [] });
  const [orderId, setOrderId] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState(JSON.stringify({ salesTypeId: "", lines: [] }));
  const [priced, setPriced] = useState<PriceResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [itemDialog, setItemDialog] = useState<{ item: CatalogItem; index: number | null } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [billsOpen, setBillsOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState<{ line: number | "order" } | null>(null);
  const [splitOrder, setSplitOrder] = useState<OrderView | null>(null);
  const [receipt, setReceipt] = useState<OrderView | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<(() => void) | null>(null);
  const [floor, setFloor] = useState<FloorMap | null>(null);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [loyalty, setLoyalty] = useState<PosLoyalty>({ enabled: false, requireCode: false, rewards: [] });
  const [rewardCode, setRewardCode] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<OrderView | null>(null);
  const [stockShort, setStockShort] = useState<{ short: { name: string; needed: number; available: number }[]; canOverride: boolean; payments: { method: string; amount: number; reference?: string | null }[] } | null>(null);
  const [approval, setApproval] = useState<{ privilege: "pos.void" | "pos.refund"; title: string; run: (input: ApprovalInput) => Promise<string | null>; done: (ok: boolean) => void } | null>(null);

  /** Menunggu atasan/alasan: dialog tetap terbuka sampai permintaan berhasil atau dibatalkan. */
  const requestApproval = (privilege: "pos.void" | "pos.refund", title: string, run: (input: ApprovalInput) => Promise<string | null>) =>
    new Promise<boolean>((resolve) => setApproval({ privilege, title, run, done: resolve }));
  const needsApprovalError = (e: unknown, privilege: string) =>
    e instanceof PosError && ((e.status === 403 && e.extra?.required === privilege) || (e.status === 422 && Boolean(e.fields?.reason)));

  const dirty = JSON.stringify(cart) !== savedKey;
  const canDiscount = ctx.can("pos.discount");

  // Katalog dimuat sekali per sesi; tipe penjualan pertama jadi bawaan.
  useEffect(() => {
    posApi<Catalog>("/catalog")
      .then((c) => {
        setCatalog(c);
        const first = c.salesTypes[0]?.id ?? "";
        setCart((cur) => (cur.salesTypeId ? cur : { ...cur, salesTypeId: first }));
        setSavedKey(JSON.stringify({ salesTypeId: first, lines: [] }));
      })
      .catch((e) => toast(e instanceof PosError ? e.message : t("network"), "error"));
  }, [toast, t]);

  // Program loyalty (reward yang bisa ditukar) dimuat sekali per sesi kasir.
  useEffect(() => {
    posApi<PosLoyalty>("/loyalty").then(setLoyalty).catch(() => undefined);
  }, []);

  // Denah dimuat sekali agar nama meja pada bill tersimpan bisa ditampilkan.
  useEffect(() => {
    posApi<FloorMap>("/tables").then(setFloor).catch(() => undefined);
  }, []);

  // Harga SELALU dihitung server; klien hanya menampilkan.
  const seq = useRef(0);
  useEffect(() => {
    if (!cart.salesTypeId || cart.lines.length === 0) {
      setPriced(null);
      return;
    }
    const mine = ++seq.current;
    const id = setTimeout(() => {
      posApi<PriceResult>("/price", { method: "POST", json: cart })
        .then((res) => {
          if (mine === seq.current) setPriced(res);
        })
        .catch((e) => {
          if (mine === seq.current) toast(e instanceof PosError ? e.message : t("network"), "error");
        });
    }, 180);
    return () => clearTimeout(id);
  }, [cart, toast, t]);

  const priceOf = useCallback(
    (item: CatalogItem) => {
      const v = item.variants[0];
      return v ? (v.prices[cart.salesTypeId] ?? v.basePrice) : 0;
    },
    [cart.salesTypeId],
  );

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.items ?? []).filter((i) => (category === "all" || i.categoryId === category) && (!q || i.name.toLowerCase().includes(q)));
  }, [catalog, category, search]);
  const visibleBundles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return category === "all" || category === "bundles" ? (catalog?.bundles ?? []).filter((b) => !q || b.name.toLowerCase().includes(q)) : [];
  }, [catalog, category, search]);

  const addLine = (line: CartLine, replaceIndex: number | null = null) =>
    setCart((c) => {
      if (replaceIndex !== null) return { ...c, lines: c.lines.map((l, i) => (i === replaceIndex ? line : l)) };
      const at = c.lines.findIndex((l) => sameLine(l, line));
      if (at >= 0) return { ...c, lines: c.lines.map((l, i) => (i === at ? ({ ...l, quantity: l.quantity + line.quantity } as CartLine) : l)) };
      return { ...c, lines: [...c.lines, line] };
    });

  const pickItem = (item: CatalogItem) => {
    if (item.variants.length === 1 && item.modifierSets.length === 0) addLine({ kind: "item", variantId: item.variants[0]!.id, quantity: 1, modifierOptionIds: [] });
    else setItemDialog({ item, index: null });
  };

  const changeQty = (index: number, delta: number) =>
    setCart((c) => ({ ...c, lines: c.lines.flatMap((l, i) => (i !== index ? [l] : l.quantity + delta < 1 ? [] : [{ ...l, quantity: l.quantity + delta } as CartLine])) }));

  const reset = (salesTypeId = cart.salesTypeId) => {
    const empty: Cart = { salesTypeId, lines: [] };
    setCart(empty);
    setSavedKey(JSON.stringify(empty));
    setOrderId(null);
    setPriced(null);
    setCustomer(null);
    setRewardCode(null);
  };

  const load = (o: OrderView) => {
    const c = cartFromOrder(o);
    setCustomer(o.customer ? { id: o.customer.id, name: o.customer.name, phone: null, email: null, member: o.customer.member, points: o.customer.points } : null);
    setRewardCode(null);
    setCart(c);
    setSavedKey(JSON.stringify(c));
    setOrderId(o.id);
  };

  /** Simpan bill (buat atau ganti isi). Mengembalikan bill tersimpan, atau null bila gagal. */
  const save = async (): Promise<OrderView | null> => {
    if (cart.lines.length === 0) return null;
    setBusy(true);
    const send = async (extra: Record<string, unknown> = {}) =>
      orderId
        ? await posApi<{ order: OrderView }>(`/orders/${orderId}`, { method: "PUT", json: { ...cart, ...extra } })
        : await posApi<{ order: OrderView }>("/orders", { method: "POST", json: cart });
    try {
      const res = await send();
      load(res.order);
      return res.order;
    } catch (e) {
      // Mengurangi/menghapus item yang sudah tersimpan: minta alasan dan (bila perlu) persetujuan atasan.
      if (orderId && needsApprovalError(e, "pos.void")) {
        let saved: OrderView | null = null;
        const ok = await requestApproval("pos.void", t("removeItemsTitle"), async (input) => {
          try {
            saved = (await send({ reason: input.reason, approval: input.approval })).order;
            return null;
          } catch (err) {
            return err instanceof PosError ? (err.fields ? Object.values(err.fields)[0]! : err.message) : t("network");
          }
        });
        if (ok && saved) {
          load(saved);
          return saved;
        }
        return null;
      }
      toast(e instanceof PosError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : t("network"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const guardLeave = (next: () => void) => (cart.lines.length > 0 && dirty ? setConfirmLeave(() => next) : next());

  const openBill = async (id: string) => {
    try {
      const { order } = await posApi<{ order: OrderView }>(`/orders/${id}`);
      if (order.status === "open") guardLeave(() => load(order));
      else setReceipt(order);
      setBillsOpen(false);
    } catch (e) {
      toast(e instanceof PosError ? e.message : t("network"), "error");
    }
  };

  const startSplit = async () => {
    const saved = dirty || !orderId ? await save() : ({ id: orderId } as OrderView);
    if (!saved) return;
    try {
      setSplitOrder((await posApi<{ order: OrderView }>(`/orders/${saved.id}`)).order);
    } catch (e) {
      toast(e instanceof PosError ? e.message : t("network"), "error");
    }
  };

  const cancelBill = async () => {
    if (!orderId) return reset();
    const ok = await requestApproval("pos.void", t("cancelBill"), async (input) => {
      try {
        await posApi(`/orders/${orderId}/void`, { method: "POST", json: { reason: input.reason, approval: input.approval } });
        return null;
      } catch (err) {
        return err instanceof PosError ? (err.fields ? Object.values(err.fields)[0]! : err.message) : t("network");
      }
    });
    if (ok) {
      toast(t("billCancelled"));
      reset();
    }
  };

  /** Diskon yang boleh dipilih: umum untuk pesanan; diskon item hanya untuk item/kategori sasarannya. */
  const discountChoices = (target: number | "order") => {
    const all = catalog?.discounts ?? [];
    if (target === "order") return all.filter((d) => d.scope === "order");
    const line = cart.lines[target];
    const item = line?.kind === "item" ? catalog?.items.find((it) => it.variants.some((v) => v.id === line.variantId)) : undefined;
    if (!item) return [];
    return all.filter((d) => d.scope === "item" && (d.itemIds.includes(item.id) || (item.categoryId !== null && d.categoryIds.includes(item.categoryId))));
  };

  const tableName = cart.tableId ? (floor?.tables.find((x) => x.id === cart.tableId)?.name ?? null) : null;
  const totals = priced?.totals;
  const empty = cart.lines.length === 0;
  const lineView = (i: number) => priced?.lines[i];

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{ctx.session.outlet.name}</div>
          <div className="truncate text-xs text-muted">{ctx.session.user.name}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" onClick={() => setBillsOpen(true)}>
            <ClipboardList size={16} aria-hidden /> {t("bills")}
          </Button>
          <Button variant="secondary" onClick={() => setShiftOpen(true)}>
            <Wallet size={16} aria-hidden /> {t("shift")}
          </Button>
          <Button variant="ghost" onClick={() => guardLeave(onLogout)} aria-label={t("logout")} title={t("logout")}>
            <LogOut size={16} aria-hidden />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_400px]">
        <section className="flex min-h-0 flex-col border-line lg:border-e" aria-label={t("catalog")}>
          <div className="space-y-2 border-b border-line bg-surface p-3">
            <div className="relative max-w-sm">
              <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <Input type="search" className="ps-9" placeholder={t("searchItems")} aria-label={t("searchItems")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t("categories")}>
              {[{ id: "all", name: t("all") }, ...(catalog?.categories ?? []), ...(catalog?.bundles.length ? [{ id: "bundles", name: t("bundles") }] : [])].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className={`h-9 shrink-0 rounded-full border px-4 text-sm font-medium ${category === c.id ? "border-brand bg-brand text-white" : "border-line bg-surface hover:bg-surface-2"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-2.5 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
            {!catalog ? <p className="col-span-full text-muted">{t("loading")}</p> : null}
            {catalog && visibleItems.length + visibleBundles.length === 0 ? <p className="col-span-full py-10 text-center text-muted">{t("noItems")}</p> : null}
            {visibleItems.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => pickItem(i)}
                className="flex min-h-24 flex-col justify-between rounded-xl border border-line bg-surface p-3 text-start transition hover:border-brand hover:shadow-sm active:bg-brand-soft"
              >
                <span className="line-clamp-2 font-medium">{i.name}</span>
                <span className="mt-2 flex items-center justify-between text-sm text-muted">
                  <span className="tabular-nums">{ctx.fmt(priceOf(i))}</span>
                  {i.variants.length === 1 && i.variants[0]!.stock !== null ? (
                    <span className={`text-xs font-medium ${i.variants[0]!.stock! <= 0 ? "text-danger" : "text-muted"}`} data-testid={`stock-${i.name}`}>
                      {i.variants[0]!.stock! <= 0 ? t("soldOut") : t("stockLeft", { count: i.variants[0]!.stock! })}
                    </span>
                  ) : null}
                  {i.variants.length > 1 || i.modifierSets.length > 0 ? <Plus size={14} aria-hidden /> : null}
                </span>
              </button>
            ))}
            {visibleBundles.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => addLine({ kind: "bundle", bundleId: b.id, quantity: 1 })}
                className="flex min-h-24 flex-col justify-between rounded-xl border border-dashed border-brand/50 bg-surface p-3 text-start hover:border-brand active:bg-brand-soft"
              >
                <span className="line-clamp-2 font-medium">{b.name}</span>
                <span className="mt-2 text-sm text-muted tabular-nums">{ctx.fmt(b.prices[cart.salesTypeId] ?? b.price)}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-surface" aria-label={t("cart")}>
          <div className="flex items-center justify-between gap-2 border-b border-line p-3">
            <Select aria-label={t("salesType")} value={cart.salesTypeId} onChange={(e) => setCart((c) => ({ ...c, salesTypeId: e.target.value }))} className="max-w-48">
              {catalog?.salesTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <div className="text-xs text-muted">{orderId ? t("savedBill") : t("newBill")}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Button variant="secondary" onClick={() => setCustomerOpen(true)} data-testid="open-customer">
              {customer ? customer.name : t("customer")}
              {customer?.member ? <span className="ms-1 text-xs text-brand">{t("pointsLabel", { count: customer.points })}</span> : null}
            </Button>
            {customer?.member && loyalty.enabled ? (
              <Button variant="secondary" onClick={() => setRewardOpen(true)} data-testid="open-reward">
                {cart.rewardId ? (loyalty.rewards.find((r) => r.id === cart.rewardId)?.name ?? t("reward")) : t("reward")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setTablesOpen(true)} data-testid="open-tables">
              <LayoutGrid size={15} aria-hidden /> {tableName ?? t("tables")}
            </Button>
            {cart.tableId ? (
              <Button variant="ghost" onClick={() => setCart((c) => ({ ...c, tableId: null }))} aria-label={t("noTable")} title={t("noTable")}>
                <X size={15} aria-hidden />
              </Button>
            ) : null}
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {empty ? <li className="p-8 text-center text-muted">{t("cartEmpty")}</li> : null}
            {cart.lines.map((l, i) => {
              const v = lineView(i);
              const item = l.kind === "item" ? catalog?.items.find((it) => it.variants.some((x) => x.id === l.variantId)) : undefined;
              return (
                <li key={i} className="space-y-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 text-start"
                      onClick={() => (item ? setItemDialog({ item, index: i }) : setDiscountOpen(canDiscount ? { line: i } : null))}
                    >
                      <span className="block truncate font-medium">{v?.name ?? "…"}</span>
                      {v?.modifiers.length ? <span className="block truncate text-xs text-muted">{v.modifiers.map((m) => m.name).join(", ")}</span> : null}
                      {l.note ? <span className="block truncate text-xs italic text-muted">{l.note}</span> : null}
                    </button>
                    <div className="text-end">
                      <div className="font-medium tabular-nums">{v ? ctx.fmt(v.afterDiscount) : "…"}</div>
                      {v && v.gross !== v.afterDiscount ? <div className="text-xs text-muted line-through tabular-nums">{ctx.fmt(v.gross)}</div> : null}
                    </div>
                  </div>
                  {v && v.promoDiscount > 0 ? <div className="text-xs text-brand">{t("promoApplied", { amount: ctx.fmt(v.promoDiscount) })}</div> : null}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1" dir="ltr">
                      <button type="button" onClick={() => changeQty(i, -1)} aria-label={t("decrease")} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-surface-2">
                        {l.quantity === 1 ? <Trash2 size={15} className="text-danger" aria-hidden /> : <Minus size={15} aria-hidden />}
                      </button>
                      <span className="w-9 text-center font-medium tabular-nums">{l.quantity}</span>
                      <button type="button" onClick={() => changeQty(i, 1)} aria-label={t("increase")} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-surface-2">
                        <Plus size={15} aria-hidden />
                      </button>
                    </div>
                    {canDiscount ? (
                      <Button variant="ghost" onClick={() => setDiscountOpen({ line: i })} aria-label={t("lineDiscount")}>
                        <Percent size={15} aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="space-y-1 border-t border-line p-3 text-sm">
            {totals ? (
              <>
                <Row label={t("subtotal")} value={ctx.fmt(totals.subtotal)} />
                {totals.discountTotal > 0 ? <Row label={t("discount")} value={`-${ctx.fmt(totals.discountTotal)}`} /> : null}
                {priced?.snapshot.gratuities.map((g, i) => (g.amount > 0 ? <Row key={`g${i}`} label={g.name} value={ctx.fmt(g.amount)} /> : null))}
                {priced?.snapshot.taxes.map((x, i) => (x.amount > 0 ? <Row key={`t${i}`} label={x.name} value={ctx.fmt(x.amount)} /> : null))}
                {totals.rounding !== 0 ? <Row label={t("rounding")} value={ctx.fmt(totals.rounding)} /> : null}
              </>
            ) : null}
            <div className="flex items-baseline justify-between pt-1 text-lg font-semibold">
              <span>{t("total")}</span>
              <span className="tabular-nums" data-testid="cart-total">
                {ctx.fmt(totals?.total ?? 0)}
              </span>
            </div>
            {canDiscount ? (
              <Button variant="ghost" className="w-full" disabled={empty} onClick={() => setDiscountOpen({ line: "order" })}>
                <Percent size={15} aria-hidden /> {cart.orderDiscount ? t("changeOrderDiscount") : t("orderDiscount")}
              </Button>
            ) : null}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <Button variant="secondary" className="h-11" disabled={empty || busy || (!dirty && Boolean(orderId))} onClick={() => void save().then((o) => o && toast(t("billSaved")))}>
                {t("saveBill")}
              </Button>
              <Button variant="secondary" className="h-11" disabled={empty || busy} onClick={() => void startSplit()}>
                <Split size={15} aria-hidden /> {t("split")}
              </Button>
              <Button className="h-11" disabled={empty || busy || !priced} onClick={() => setPayOpen(true)}>
                {t("pay")}
              </Button>
            </div>
            {!empty || orderId ? (
              <Button variant="ghost" className="w-full text-danger" onClick={() => void cancelBill()}>
                {orderId ? t("cancelBill") : t("clearCart")}
              </Button>
            ) : null}
          </div>
        </aside>
      </div>

      {itemDialog ? (
        <ItemDialog
          ctx={ctx}
          item={itemDialog.item}
          salesTypeId={cart.salesTypeId}
          initial={itemDialog.index !== null ? cart.lines[itemDialog.index] : undefined}
          onClose={() => setItemDialog(null)}
          onConfirm={(line) => {
            addLine(line, itemDialog.index);
            setItemDialog(null);
          }}
        />
      ) : null}

      {discountOpen ? (
        <DiscountDialog
          ctx={ctx}
          discounts={discountChoices(discountOpen.line)}
          current={discountOpen.line === "order" ? cart.orderDiscount : cart.lines[discountOpen.line]?.discount}
          onClose={() => setDiscountOpen(null)}
          onPick={(pick: DiscountPick | null) => {
            const target = discountOpen.line;
            setCart((c) =>
              target === "order" ? { ...c, orderDiscount: pick } : { ...c, lines: c.lines.map((l, i) => (i === target ? ({ ...l, discount: pick } as CartLine) : l)) },
            );
            setDiscountOpen(null);
          }}
        />
      ) : null}

      {payOpen && totals ? (
        <PayDialog
          ctx={ctx}
          total={totals.total}
          onClose={() => setPayOpen(false)}
          onPay={async (payments, stockOverride = false) => {
            const saved = dirty || !orderId ? await save() : ({ id: orderId } as OrderView);
            if (!saved) return false;
            try {
              const res = await posApi<{ order: OrderView }>(`/orders/${saved.id}/pay`, { method: "POST", json: { payments, ...(stockOverride ? { stockOverride: true } : {}), ...(rewardCode ? { rewardCode } : {}) } });
              setPayOpen(false);
              setReceipt(res.order);
              reset();
              try {
                onShift((await posApi<{ shift: ShiftView }>("/shifts/current")).shift!);
              } catch {
                /* ringkasan shift diperbarui saat dibuka */
              }
              return true;
            } catch (e) {
              if (e instanceof PosError && e.status === 409 && Array.isArray(e.extra?.short)) {
                setStockShort({ short: e.extra.short as never, canOverride: e.extra.canOverride === true, payments });
                return false;
              }
              toast(e instanceof PosError ? (e.fields?.payments ?? e.message) : t("network"), "error");
              return false;
            }
          }}
        />
      ) : null}

      {stockShort ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="alertdialog" aria-label={t("stockShortTitle")} data-testid="stock-short">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xl">
            <h2 className="font-semibold">{t("stockShortTitle")}</h2>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {stockShort.short.map((s) => (
                <li key={s.name} className="flex justify-between gap-3 px-3 py-2">
                  <span>{s.name}</span>
                  <span className="tabular-nums text-danger">
                    {t("stockNeeded", { needed: s.needed, available: s.available })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">{stockShort.canOverride ? t("stockOverrideHelp") : t("stockBlockedHelp")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStockShort(null)}>
                {t("back")}
              </Button>
              {stockShort.canOverride ? (
                <Button
                  variant="danger"
                  data-testid="stock-override"
                  onClick={async () => {
                    const p = stockShort.payments;
                    setStockShort(null);
                    const orderToPay = orderId;
                    if (!orderToPay) return;
                    try {
                      const res = await posApi<{ order: OrderView }>(`/orders/${orderToPay}/pay`, { method: "POST", json: { payments: p, stockOverride: true } });
                      setPayOpen(false);
                      setReceipt(res.order);
                      reset();
                    } catch (e) {
                      toast(e instanceof PosError ? e.message : t("network"), "error");
                    }
                  }}
                >
                  {t("sellAnyway")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {billsOpen ? <BillsDialog ctx={ctx} onClose={() => setBillsOpen(false)} onOpen={(id) => void openBill(id)} /> : null}
      {shiftOpen ? <ShiftDialog ctx={ctx} shift={shift} onShift={onShift} onClose={() => setShiftOpen(false)} onClosed={onShiftClosed} /> : null}
      {receipt ? <ReceiptDialog ctx={ctx} order={receipt} onClose={() => setReceipt(null)} onRefund={() => setRefunding(receipt)} /> : null}
      {refunding ? (
        <RefundDialog
          ctx={ctx}
          order={refunding}
          onClose={() => setRefunding(null)}
          onDone={(o) => {
            setRefunding(null);
            setReceipt(o);
            posApi<{ shift: ShiftView }>("/shifts/current").then((r) => onShift(r.shift)).catch(() => undefined);
          }}
        />
      ) : null}
      {customerOpen ? (
        <CustomerDialog
          loyaltyOn={loyalty.enabled}
          onClose={() => setCustomerOpen(false)}
          onPick={(c) => {
            setCustomer(c);
            setRewardCode(null);
            setCart((cur) => ({ ...cur, customerId: c?.id ?? null, rewardId: c && cur.customerId === c.id ? cur.rewardId : null }));
            setCustomerOpen(false);
          }}
        />
      ) : null}
      {rewardOpen && customer ? (
        <RewardDialog
          ctx={ctx}
          customer={customer}
          loyalty={loyalty}
          currentRewardId={cart.rewardId}
          onClose={() => setRewardOpen(false)}
          onPick={(r: PosReward | null, code) => {
            setCart((cur) => ({ ...cur, rewardId: r?.id ?? null }));
            setRewardCode(code);
            setRewardOpen(false);
          }}
        />
      ) : null}
      {tablesOpen ? (
        <TablesDialog
          ctx={ctx}
          currentTableId={cart.tableId}
          onLoaded={setFloor}
          onClose={() => setTablesOpen(false)}
          onPick={(tb) => {
            setCart((c) => ({ ...c, tableId: tb?.id ?? null }));
            setTablesOpen(false);
          }}
          onOpenBill={(id) => {
            setTablesOpen(false);
            void openBill(id);
          }}
        />
      ) : null}
      {approval ? (
        <ApprovalDialog
          ctx={ctx}
          privilege={approval.privilege}
          title={approval.title}
          onRun={approval.run}
          onClose={(ok) => {
            approval.done(ok);
            setApproval(null);
          }}
        />
      ) : null}
      {splitOrder ? (
        <SplitDialog
          ctx={ctx}
          order={splitOrder}
          onClose={() => setSplitOrder(null)}
          onDone={(kept) => {
            setSplitOrder(null);
            load(kept);
            toast(t("splitDone"));
          }}
        />
      ) : null}

      {confirmLeave ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="alertdialog" aria-label={t("unsavedTitle")}>
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xl">
            <h2 className="font-semibold">{t("unsavedTitle")}</h2>
            <p className="text-sm text-muted">{t("unsavedBody")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmLeave(null)}>
                {t("stay")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const next = confirmLeave;
                  setConfirmLeave(null);
                  next();
                }}
              >
                {t("discardChanges")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-muted">
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);
