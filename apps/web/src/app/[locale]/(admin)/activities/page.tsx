"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { Locale } from "@naqdi/i18n";
import { Badge, Card, DataTable, PageHeader, Pager, Select } from "@/components/ui";
import { api, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useList } from "@/lib/useList";

interface Row {
  id: string;
  kind: string;
  orderId: string | null;
  receiptNumber: number | null;
  user: string;
  approvedBy: string | null;
  detail: Record<string, unknown> | null;
  at: string;
}

const kinds = ["bill_created", "bill_updated", "item_removed", "bill_voided", "paid", "split", "table_changed", "refund"] as const;
const tone = (k: string) => (k === "refund" || k === "bill_voided" || k === "item_removed" ? "bad" : k === "paid" ? "good" : "neutral");

export default function ActivitiesPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const { can } = useAuth();
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState("");
  const [kind, setKind] = useState("");
  const allowed = can("reports.view");
  const list = useList<Row>("/activities", 20, { outletId: outletId || undefined, kind: kind || undefined }, allowed);
  const tx = t as unknown as (key: string) => string;
  const when = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

  useEffect(() => {
    api<Paged<{ id: string; name: string }>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  if (!allowed) return <p className="text-muted">{t("errors.forbidden")}</p>;

  return (
    <div className="space-y-5">
      <PageHeader title={t("activities.title")} subtitle={list.data ? String(list.data.total) : t("activities.subtitle")} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select aria-label={t("devices.outlet")} value={outletId} onChange={(e) => setOutletId(e.target.value)} className="max-w-56">
            <option value="">{t("common.allOutlets")}</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
          <Select aria-label={t("activities.kind")} value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-52">
            <option value="">{t("activities.allKinds")}</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{tx(`activities.kinds.${k}`)}</option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={[
            { key: "when", header: t("audit.when"), cell: (r) => <span className="ltr-text whitespace-nowrap text-muted">{when.format(new Date(r.at))}</span> },
            { key: "kind", header: t("activities.kind"), cell: (r) => <Badge tone={tone(r.kind)}>{tx(`activities.kinds.${r.kind}`)}</Badge> },
            { key: "bill", header: t("activities.bill"), cell: (r) => (r.receiptNumber ? `#${r.receiptNumber}` : <span className="text-muted">-</span>) },
            { key: "user", header: t("audit.user"), cell: (r) => r.user },
            { key: "approved", header: t("activities.approvedBy"), cell: (r) => r.approvedBy ?? <span className="text-muted">-</span> },
            {
              key: "detail",
              header: t("audit.details"),
              cell: (r) =>
                r.detail ? (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">{typeof r.detail.reason === "string" ? r.detail.reason : t("audit.details")}</summary>
                    <pre dir="ltr" className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-start">{JSON.stringify(r.detail, null, 2)}</pre>
                  </details>
                ) : null,
            },
          ]}
          rows={list.data?.items ?? null}
          emptyText={t("common.noData")}
          loadingText={t("common.loading")}
        />
        {list.data ? <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} /> : null}
      </Card>
    </div>
  );
}
