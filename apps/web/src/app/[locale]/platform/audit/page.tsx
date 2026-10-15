"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Card, Pager } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { PlatformError, platformApi } from "@/lib/platformApi";

interface AuditItem {
  id: string;
  action: string;
  businessId: string | null;
  business: string | null;
  admin: string | null;
  detail: Record<string, unknown> | null;
  at: string;
}

export default function PlatformAuditPage() {
  const t = useTranslations("platformUi");
  const locale = useLocale();
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const pageSize = 30;
  const when = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);

  useEffect(() => {
    platformApi<{ items: AuditItem[] }>(`/audit?page=${page}&pageSize=${pageSize}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof PlatformError ? e.message : t("network")));
  }, [page, t]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navAudit")}</h1>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <Card>
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              {["when", "admin", "action", "business", "detail"].map((k) => (
                <th key={k} className="px-3 py-2 text-start font-medium">{t(`audit.${k}` as never)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items === null ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">{t("loading")}</td></tr> : null}
            {items?.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">{t("none")}</td></tr> : null}
            {items?.map((a) => (
              <tr key={a.id} data-testid="audit-row">
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{when.format(new Date(a.at))}</td>
                <td className="px-3 py-2">{a.admin ?? t("system")}</td>
                <td className="px-3 py-2">{t(`action.${a.action}` as never)}</td>
                <td className="px-3 py-2">{a.businessId ? <Link href={`/platform/businesses/${a.businessId}`} className="text-brand underline">{a.business ?? a.businessId.slice(0, 8)}</Link> : "-"}</td>
                <td className="px-3 py-2">
                  {a.detail ? (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer">{typeof a.detail.note === "string" ? a.detail.note : t("audit.detail")}</summary>
                      <pre dir="ltr" className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-start">{JSON.stringify(a.detail, null, 2)}</pre>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items ? <Pager page={page} pageSize={pageSize} total={items.length < pageSize ? (page - 1) * pageSize + items.length : page * pageSize + 1} onPage={setPage} /> : null}
      </Card>
    </div>
  );
}
