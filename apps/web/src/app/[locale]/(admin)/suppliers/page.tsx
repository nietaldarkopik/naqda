"use client";

import { useTranslations } from "next-intl";
import { SimpleCrud } from "@/components/SimpleCrud";

export default function SuppliersPage() {
  const t = useTranslations();
  return (
    <SimpleCrud
      endpoint="/suppliers"
      title={t("inventory.suppliers.title")}
      createLabel={t("inventory.suppliers.create")}
      editLabel={t("inventory.suppliers.edit")}
      writePrivilege="inventory.manage"
      defaults={{ phone: "", email: "", address: "", city: "", postalCode: "" }}
      fields={[
        { key: "phone", kind: "text", label: t("common.phone") },
        { key: "email", kind: "text", label: t("common.email") },
        { key: "address", kind: "text", label: t("common.address") },
        { key: "city", kind: "text", label: t("inventory.suppliers.city") },
        { key: "postalCode", kind: "text", label: t("inventory.suppliers.postalCode") },
      ]}
      columns={() => [
        { key: "name", header: t("common.name"), cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: "phone", header: t("common.phone"), cell: (r) => <span className="ltr-text">{String(r.phone ?? "-")}</span> },
        { key: "email", header: t("common.email"), cell: (r) => <span className="ltr-text">{String(r.email ?? "-")}</span> },
        { key: "city", header: t("inventory.suppliers.city"), cell: (r) => String(r.city ?? "-") },
      ]}
    />
  );
}
