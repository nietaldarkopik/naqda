"use client";

import { useLocale, useTranslations } from "next-intl";

/** Pengaturan struk (sama dengan apps/api/src/settings/service.ts). */
export interface ReceiptSettings {
  headerText: string;
  taxId: string;
  taxIdLabel: string;
  showOutletName: boolean;
  showOutletAddress: boolean;
  showOutletPhone: boolean;
  website: string;
  instagram: string;
  footerText: string | null;
  showCashier: boolean;
  showTable: boolean;
  showCustomer: boolean;
  showTaxBreakdown: boolean;
  paperMm: 58 | 80;
}

export const defaultReceiptSettings: ReceiptSettings = {
  headerText: "",
  taxId: "",
  taxIdLabel: "",
  showOutletName: true,
  showOutletAddress: true,
  showOutletPhone: true,
  website: "",
  instagram: "",
  footerText: null,
  showCashier: true,
  showTable: true,
  showCustomer: true,
  showTaxBreakdown: true,
  paperMm: 80,
};

export interface ReceiptData {
  businessName: string;
  outlet: { name: string; address: string | null; phone: string | null };
  receiptNumber: number | null;
  /** Rujukan struk sementara (penjualan offline yang belum disinkronkan). */
  provisionalRef?: string | null;
  at: string | Date;
  cashier: string;
  table: string | null;
  lines: { id: string; quantity: number; name: string; unitPrice: number; modifiers: string[]; discount: number }[];
  subtotal: number;
  discountTotal: number;
  charges: { name: string; amount: number; kind: "gratuity" | "tax" }[];
  rounding: number;
  total: number;
  payments: { label: string; amount: number }[];
  change: number;
  refunded: number;
  customer: { name: string; member: boolean; points: number } | null;
  pointsRedeemed: number;
  pointsEarned: number;
  paid: boolean;
}

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className={`flex justify-between gap-2 ${bold ? "text-sm font-bold" : ""}`}>
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

/** Struk. Dipakai kasir (cetak) dan pratinjau di Back Office agar yang dirancang sama dengan yang tercetak. */
export function ReceiptView({ data, settings, fmt }: { data: ReceiptData; settings: ReceiptSettings; fmt: (minor: number) => string }) {
  const t = useTranslations("cashier");
  const r = useTranslations("receipt");
  const locale = useLocale();
  const charges = settings.showTaxBreakdown ? data.charges.filter((c) => c.amount > 0) : [];
  const hidden = !settings.showTaxBreakdown ? data.charges.reduce((a, c) => a + c.amount, 0) : 0;
  const footer = settings.footerText === null ? r("defaultFooter") : settings.footerText;
  return (
    <div
      className="print-area mx-auto w-full space-y-2 font-mono text-xs"
      style={{ maxWidth: settings.paperMm === 58 ? "15rem" : "20rem" }}
      data-paper={settings.paperMm}
      data-testid="receipt"
    >
      <div className="text-center">
        <div className="text-sm font-bold">{data.businessName}</div>
        {settings.showOutletName ? <div>{data.outlet.name}</div> : null}
        {settings.showOutletAddress && data.outlet.address ? <div>{data.outlet.address}</div> : null}
        {settings.showOutletPhone && data.outlet.phone ? <div dir="ltr">{data.outlet.phone}</div> : null}
        {settings.headerText.split("\n").filter(Boolean).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {settings.taxId ? (
          <div data-testid="receipt-taxid">
            {settings.taxIdLabel || r("taxIdDefault")}: <span dir="ltr">{settings.taxId}</span>
          </div>
        ) : null}
        <div>
          {data.receiptNumber ? `#${data.receiptNumber} · ` : data.provisionalRef ? `${data.provisionalRef} · ` : ""}
          {new Date(data.at).toLocaleString(locale)}
        </div>
        {settings.showCashier ? <div>{data.cashier}</div> : null}
        {settings.showTable && data.table ? <div>{r("table", { name: data.table })}</div> : null}
      </div>
      <hr className="border-dashed border-line" />
      {data.lines.map((l) => (
        <div key={l.id}>
          <div className="flex justify-between gap-2">
            <span>
              {l.quantity}× {l.name}
            </span>
            <span className="tabular-nums">{fmt(l.unitPrice * l.quantity)}</span>
          </div>
          {l.modifiers.map((m, i) => (
            <div key={i} className="ps-3 text-muted">
              + {m}
            </div>
          ))}
          {l.discount > 0 ? <div className="ps-3 text-muted">− {fmt(l.discount)}</div> : null}
        </div>
      ))}
      <hr className="border-dashed border-line" />
      <Row label={t("subtotal")} value={fmt(data.subtotal)} />
      {data.discountTotal > 0 ? <Row label={t("discount")} value={`-${fmt(data.discountTotal)}`} /> : null}
      {charges.map((c, i) => (
        <Row key={i} label={c.name} value={fmt(c.amount)} />
      ))}
      {hidden > 0 ? <Row label={r("taxAndService")} value={fmt(hidden)} /> : null}
      {data.rounding !== 0 ? <Row label={t("rounding")} value={fmt(data.rounding)} /> : null}
      <Row label={t("total")} value={fmt(data.total)} bold />
      {data.payments.map((p, i) => (
        <Row key={i} label={p.label} value={fmt(p.amount)} />
      ))}
      {data.change > 0 ? <Row label={t("change")} value={fmt(data.change)} /> : null}
      {data.refunded > 0 ? <Row label={t("refunded")} value={`-${fmt(data.refunded)}`} /> : null}
      {settings.showCustomer && data.customer ? (
        <div className="border-t border-dashed border-line pt-2" data-testid="receipt-loyalty">
          <div>{data.customer.name}</div>
          {data.pointsRedeemed > 0 ? <Row label={t("pointsRedeemed")} value={`-${data.pointsRedeemed}`} /> : null}
          {data.pointsEarned > 0 ? <Row label={t("pointsEarned")} value={`+${data.pointsEarned}`} /> : null}
          {data.customer.member ? <Row label={t("pointsBalance")} value={String(data.customer.points)} /> : null}
        </div>
      ) : null}
      {!data.paid ? <div className="text-center font-bold">{t("notPaid")}</div> : null}
      {(settings.website || settings.instagram || footer) && (
        <div className="space-y-0.5 border-t border-dashed border-line pt-2 text-center">
          {settings.website ? <div dir="ltr">{settings.website}</div> : null}
          {settings.instagram ? <div dir="ltr">{settings.instagram}</div> : null}
          {footer ? <div>{footer}</div> : null}
        </div>
      )}
    </div>
  );
}
