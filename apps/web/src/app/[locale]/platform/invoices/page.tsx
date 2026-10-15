"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { exponentOf } from "@naqdi/domain";
import type { Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Field, Input, Modal, Pager, Select, useToast } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatMinor } from "@/lib/money";
import { PlatformError, platformApi, platformBlobUrl, usePlatformSession } from "@/lib/platformApi";

interface Inv {
  id: string;
  number: string;
  plan: string;
  interval: "monthly" | "yearly";
  amount: number;
  currency: string;
  status: "open" | "pending" | "paid" | "void";
  custom: boolean;
  note: string | null;
  rejectReason: string | null;
  createdAt: string;
  paidAt: string | null;
  businessId: string;
  business: string;
  proof: { bank: string; sender: string; transferredOn: string; note: string | null; hasImage: boolean; at: string } | null;
}

const tone = (s: Inv["status"]) => (s === "paid" ? "good" : s === "pending" ? "warn" : s === "void" ? "neutral" : "bad");
const planName = (p: string) => (p === "basic" ? "Starter" : p === "pro" ? "Pro" : p === "unlimited" ? "Enterprise" : p);

export default function PlatformInvoicesPage() {
  const t = useTranslations("platformUi");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { admin } = usePlatformSession();
  const canWrite = admin?.role === "owner";
  const [items, setItems] = useState<Inv[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [open, setOpen] = useState<Inv | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 25;

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit" }), [locale]);
  const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "-");
  const money = (i: Inv) => formatMinor(i.amount, exponentOf(i.currency), i.currency, locale);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(status ? { status } : {}) });
    try {
      const r = await platformApi<{ items: Inv[]; total: number }>(`/invoices?${qs}`);
      setItems(r.items);
      setTotal(r.total);
      setError("");
    } catch (e) {
      setError(e instanceof PlatformError ? e.message : t("network"));
    }
  }, [page, status, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const show = async (inv: Inv) => {
    setOpen(inv);
    setReason("");
    setRejecting(false);
    setImage(null);
    try {
      // Daftar tidak membawa bukti; ambil rinciannya.
      const full = (await platformApi<{ invoice: Inv }>(`/invoices/${inv.id}`)).invoice;
      setOpen(full);
      if (full.proof?.hasImage) setImage(await platformBlobUrl(`/invoices/${inv.id}/proof-image`));
    } catch (e) {
      toast(e instanceof PlatformError ? e.message : t("network"), "error");
    }
  };
  const close = () => {
    if (image) URL.revokeObjectURL(image);
    setOpen(null);
    setImage(null);
  };

  const approve = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const r = await platformApi<{ periodEndsAt: string; stillSuspended: boolean }>(`/invoices/${open.id}/approve`, { method: "POST", json: {} });
      toast(t(r.stillSuspended ? "approvedSuspended" : "approved", { date: day(r.periodEndsAt) }));
      close();
      await load();
    } catch (e) {
      toast(e instanceof PlatformError ? e.message : t("network"), "error");
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await platformApi(`/invoices/${open.id}/reject`, { method: "POST", json: { reason } });
      toast(t("rejectedOk"));
      close();
      await load();
    } catch (e) {
      toast(e instanceof PlatformError ? (e.fields ? Object.values(e.fields)[0]! : e.message) : t("network"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("invoicesTitle")} <span className="text-base font-normal text-muted tabular-nums" data-testid="inv-total">({total})</span></h1>
        <Select className="w-52" aria-label={t("inv.status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="inv-filter">
          <option value="">{t("invoiceStatusAll")}</option>
          {["pending", "open", "paid", "void"].map((s) => <option key={s} value={s}>{t(`invStatus.${s}` as never)}</option>)}
        </Select>
      </div>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="inv-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>{["number", "business", "plan", "amount", "status", "date"].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`inv.${k}` as never)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items === null ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">{t("loading")}</td></tr> : null}
            {items?.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">{t("none")}</td></tr> : null}
            {items?.map((i) => (
              <tr key={i.id} data-testid="inv-row" className="cursor-pointer hover:bg-surface-2" onClick={() => void show(i)}>
                <td className="px-3 py-2" dir="ltr">{i.number}</td>
                <td className="px-3 py-2">{i.business}</td>
                <td className="px-3 py-2">{planName(i.plan)} · {i.interval}</td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">{money(i)}</td>
                <td className="px-3 py-2"><Badge tone={tone(i.status)}>{t(`invStatus.${i.status}` as never)}</Badge></td>
                <td className="px-3 py-2" dir="ltr">{day(i.paidAt ?? i.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items ? <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} /> : null}
      </Card>

      <Modal
        open={open !== null}
        title={open ? `${t("invoiceDetail")} ${open.number}` : ""}
        onClose={close}
        wide
        footer={
          open && canWrite && (open.status === "pending" || open.status === "open") ? (
            rejecting ? (
              <>
                <Button variant="secondary" onClick={() => setRejecting(false)}>{t("cancel")}</Button>
                <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => void reject()} data-testid="inv-reject-confirm">{t("confirmReject")}</Button>
              </>
            ) : (
              <>
                {open.status === "pending" ? <Button variant="secondary" onClick={() => setRejecting(true)} data-testid="inv-reject">{t("reject")}</Button> : null}
                <Button disabled={busy} onClick={() => void approve()} data-testid="inv-approve">{t("approve")}</Button>
              </>
            )
          ) : (
            <Button variant="secondary" onClick={close}>{t("close")}</Button>
          )
        }
      >
        {open ? (
          <div className="space-y-4 text-sm" data-testid="inv-detail">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-muted">{t("inv.business")}</dt><dd className="font-medium"><Link href={`/platform/businesses/${open.businessId}`} className="text-brand underline">{open.business}</Link></dd></div>
              <div><dt className="text-muted">{t("inv.plan")}</dt><dd className="font-medium">{planName(open.plan)} · {open.interval}</dd></div>
              <div><dt className="text-muted">{t("inv.amount")}</dt><dd className="text-lg font-semibold" dir="ltr">{money(open)}</dd></div>
            </dl>
            {open.note ? <p className="text-muted">{open.note}</p> : null}
            {open.rejectReason ? <p className="text-danger">{open.rejectReason}</p> : null}
            <section>
              <h3 className="mb-1 font-medium">{t("proof")}</h3>
              {open.proof ? (
                <div className="space-y-2" data-testid="inv-proof">
                  <dl className="grid gap-2 sm:grid-cols-3">
                    <div><dt className="text-muted">{t("proofBank")}</dt><dd dir="auto">{open.proof.bank}</dd></div>
                    <div><dt className="text-muted">{t("proofSender")}</dt><dd dir="auto">{open.proof.sender}</dd></div>
                    <div><dt className="text-muted">{t("proofDate")}</dt><dd dir="ltr">{open.proof.transferredOn}</dd></div>
                  </dl>
                  {open.proof.note ? <p dir="auto"><span className="text-muted">{t("proofNote")}: </span>{open.proof.note}</p> : null}
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL objek sementara dari blob; bukan berkas statis
                    <img src={image} alt={t("proofImage")} className="max-h-96 rounded-lg border border-line" data-testid="inv-proof-image" />
                  ) : null}
                </div>
              ) : (
                <p className="text-muted">{t("noProof")}</p>
              )}
            </section>
            {rejecting ? <Field label={t("rejectReason")}>{(id) => <Input id={id} value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} data-testid="inv-reject-reason" />}</Field> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
