"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Locale } from "@naqdi/i18n";
import { Badge, Card, DataTable, PageHeader, Pager, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useList } from "@/lib/useList";

interface AuditRow {
  id: string;
  entityType: string;
  entityId: string | null;
  action: "create" | "update" | "delete" | "import";
  summary: string | null;
  changes: Record<string, unknown> | null;
  userName: string | null;
  createdAt: string;
}

const entityTypes = ["item", "category", "brand", "sales_type", "tax", "gratuity", "discount", "modifier_set", "bundle", "promo", "outlet", "translation", "device", "table", "table_group", "user", "user_pin", "role", "settings", "payment_method", "customer", "ingredient", "stock_adjustment", "purchase_order", "transfer", "production"];
const actions = ["create", "update", "delete", "import"] as const;

export default function AuditPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const { can } = useAuth();
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const list = useList<AuditRow>("/audit", 15, { entityType: entityType || undefined, action: action || undefined }, can("settings.manage"));
  // Tipe dinamis dari server; kuncinya tidak dikenal saat kompilasi.
  const tx = t as unknown as (key: string) => string;
// Angka murni 24 jam dengan digit Latin: tidak ambigu untuk jejak audit dan aman di teks RTL.
  const when = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

  if (!can("settings.manage")) {
    return <p className="text-muted">{t("errors.forbidden")}</p>;
  }

  const flags = (r: AuditRow) => {
    const out: string[] = [];
    if (r.changes?.priceChanged === true) out.push(t("audit.priceChanged"));
    if (r.changes?.taxModeChanged === true) out.push(t("audit.taxModeChanged"));
    return out;
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("audit.title")} subtitle={list.data ? String(list.data.total) : undefined} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select aria-label={t("audit.entity")} value={entityType} onChange={(e) => setEntityType(e.target.value)} className="max-w-52">
            <option value="">{t("audit.allEntities")}</option>
            {entityTypes.map((e) => (
              <option key={e} value={e}>{tx(`audit.entities.${e}`)}</option>
            ))}
          </Select>
          <Select aria-label={t("audit.action")} value={action} onChange={(e) => setAction(e.target.value)} className="max-w-44">
            <option value="">{t("audit.allActions")}</option>
            {actions.map((a) => (
              <option key={a} value={a}>{tx(`audit.actions.${a}`)}</option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={[
            { key: "when", header: t("audit.when"), cell: (r) => <span className="ltr-text whitespace-nowrap text-muted">{when.format(new Date(r.createdAt))}</span> },
            { key: "user", header: t("audit.user"), cell: (r) => r.userName ?? <span className="text-muted">{t("audit.system")}</span> },
            { key: "entity", header: t("audit.entity"), cell: (r) => <Badge>{tx(`audit.entities.${r.entityType}`) || r.entityType}</Badge> },
            {
              key: "action",
              header: t("audit.action"),
              cell: (r) => <Badge tone={r.action === "delete" ? "bad" : r.action === "create" ? "good" : "neutral"}>{tx(`audit.actions.${r.action}`)}</Badge>,
            },
            {
              key: "summary",
              header: t("audit.summary"),
              cell: (r) => (
                <div className="space-y-1">
                  <div className="font-medium">{r.summary ?? "-"}</div>
                  <div className="flex flex-wrap gap-1">
                    {flags(r).map((f) => (
                      <Badge key={f} tone="warn">{f}</Badge>
                    ))}
                  </div>
                  {r.changes ? (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer">{t("audit.details")}</summary>
                      <pre dir="ltr" className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-start">{JSON.stringify(r.changes, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
              ),
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
