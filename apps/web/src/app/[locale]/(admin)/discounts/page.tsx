"use client";

import { useTranslations } from "next-intl";
import { SimpleCrud } from "@/components/SimpleCrud";
import { Badge } from "@/components/ui";

export default function DiscountsPage() {
  const t = useTranslations();
  return (
    <SimpleCrud
      endpoint="/discounts"
      title={t("catalog.discounts.title")}
      createLabel={t("catalog.discounts.create")}
      editLabel={t("catalog.discounts.edit")}
      outletField="outletIds"
      defaults={{ kind: "percent", scope: "order", status: "active", customizable: false, itemIds: [], categoryIds: [] }}
      fields={[
        { key: "kind", kind: "select", label: t("catalog.discounts.kind"), options: [{ value: "percent", label: t("catalog.discounts.percent") }, { value: "amount", label: t("catalog.discounts.amount") }] },
        // Nilai mengikuti jenis: persen (disimpan basis point) atau nominal uang.
        { key: "value", kind: "dynamic", kindKey: "kind", label: t("catalog.discounts.value") },
        { key: "scope", kind: "select", label: t("catalog.discounts.scope"), options: [{ value: "order", label: t("catalog.discounts.scopeOrder") }, { value: "item", label: t("catalog.discounts.scopeItem") }] },
        { key: "itemIds", kind: "multi", label: t("catalog.discounts.targetItems"), endpoint: "/items", showWhen: { key: "scope", equals: "item" } },
        { key: "categoryIds", kind: "multi", label: t("catalog.discounts.targetCategories"), endpoint: "/categories", showWhen: { key: "scope", equals: "item" } },
        { key: "customizable", kind: "bool", label: t("catalog.discounts.customizable") },
        { key: "status", kind: "select", label: t("common.status"), options: [{ value: "active", label: t("common.active") }, { value: "inactive", label: t("common.inactive") }] },
        { key: "outletIds", kind: "multi", label: t("common.outlets"), endpoint: "/outlets" },
      ]}
      columns={({ money }) => [
        { key: "name", header: t("common.name"), cell: (r) => <span className="font-medium">{r.name}</span> },
        {
          key: "value",
          header: t("catalog.discounts.value"),
          cell: (r) => <span className="tabular-nums">{r.kind === "percent" ? `${Number(r.value) / 100}%` : money(Number(r.value))}</span>,
        },
        {
          key: "scope",
          header: t("catalog.discounts.scope"),
          cell: (r) => <Badge tone={r.scope === "item" ? "warn" : "neutral"}>{r.scope === "item" ? t("catalog.discounts.scopeItem") : t("catalog.discounts.scopeOrder")}</Badge>,
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
