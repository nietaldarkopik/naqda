"use client";

import { useTranslations } from "next-intl";
import { SimpleCrud } from "@/components/SimpleCrud";

export default function TaxesPage() {
  const t = useTranslations();
  return (
    <SimpleCrud
      endpoint="/taxes"
      title={t("catalog.taxes.title")}
      createLabel={t("catalog.taxes.create")}
      editLabel={t("catalog.taxes.edit")}
      outletField="outletIds"
      fields={[
        { key: "rateBp", kind: "percent", label: t("catalog.rate") },
        { key: "outletIds", kind: "multi", label: t("common.outlets"), endpoint: "/outlets" },
      ]}
      columns={() => [
        { key: "name", header: t("common.name"), cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: "rate", header: t("catalog.rate"), cell: (r) => <span className="tabular-nums">{Number(r.rateBp) / 100}%</span> },
        { key: "outlets", header: t("common.outlets"), cell: (r) => <span className="tabular-nums text-muted">{((r.outletIds as string[]) ?? []).length}</span> },
      ]}
    />
  );
}
