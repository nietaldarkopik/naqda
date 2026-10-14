"use client";

import { useTranslations } from "next-intl";
import { SimpleCrud } from "@/components/SimpleCrud";

export default function CategoriesPage() {
  const t = useTranslations("catalog.categories");
  return <SimpleCrud endpoint="/categories" title={t("title")} createLabel={t("create")} editLabel={t("edit")} fields={[]} translatable="category" />;
}
