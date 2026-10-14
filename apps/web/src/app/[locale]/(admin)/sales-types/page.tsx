"use client";

import { useTranslations } from "next-intl";
import { SimpleCrud } from "@/components/SimpleCrud";
import { Badge } from "@/components/ui";

export default function SalesTypesPage() {
  const t = useTranslations();
  return (
    <SimpleCrud
      endpoint="/sales-types"
      title={t("catalog.salesTypes.title")}
      createLabel={t("catalog.salesTypes.create")}
      editLabel={t("catalog.salesTypes.edit")}
      defaults={{ status: "active" }}
      translatable="sales_type"
      fields={[
        { key: "status", kind: "select", label: t("common.status"), options: [{ value: "active", label: t("common.active") }, { value: "inactive", label: t("common.inactive") }] },
        { key: "gratuityIds", kind: "multi", label: t("catalog.salesTypes.gratuities"), endpoint: "/gratuities" },
      ]}
      columns={({ labelOf }) => [
        { key: "name", header: t("common.name"), cell: (r) => <span className="font-medium">{r.name}</span> },
        {
          key: "gratuity",
          header: t("nav.gratuities"),
          cell: (r) => <span className="text-muted">{((r.gratuityIds as string[]) ?? []).map((id) => labelOf("gratuityIds", id)).filter(Boolean).join(", ") || "-"}</span>,
        },
        {
          key: "status",
          header: t("common.status"),
          cell: (r) => <Badge tone={r.status === "active" ? "good" : "neutral"}>{r.status === "active" ? t("common.active") : t("common.inactive")}</Badge>,
        },
      ]}
    />
  );
}
