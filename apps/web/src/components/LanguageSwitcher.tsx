"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { localeLabels, locales, type Locale } from "@naqdi/i18n";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className={`inline-flex items-center gap-2 text-sm ${tone === "dark" ? "text-side-text" : "text-muted"}`}>
      <Languages size={16} aria-hidden />
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(e) => router.replace(pathname, { locale: e.target.value as Locale })}
        className={`h-8 rounded-md border px-2 text-sm ${
          tone === "dark" ? "border-white/20 bg-transparent text-side-text" : "border-line bg-surface text-ink"
        }`}
      >
        {locales.map((l) => (
          <option key={l} value={l} className="text-black">
            {localeLabels[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
