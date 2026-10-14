"use client";

import { useTranslations } from "next-intl";
import { SimpleCrud } from "@/components/SimpleCrud";

export default function BrandsPage() {
  const t = useTranslations("catalog.brands");
  return <SimpleCrud endpoint="/brands" title={t("title")} createLabel={t("create")} editLabel={t("edit")} fields={[]} translatable="brand" />;
}
