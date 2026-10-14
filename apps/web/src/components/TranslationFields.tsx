"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { localeLabels, locales, type Locale } from "@naqdi/i18n";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Input, Textarea } from "./ui";

export type TranslationDraft = Record<string, Record<string, string>>;

/**
 * Terjemahan nama (dan deskripsi) per bahasa untuk satu entitas. Bahasa dasar bisnis tidak diterjemahkan
 * karena nama aslinya sudah ada di tabelnya. Dipakai bersama formulir entitas: panggil `load(id)` saat
 * membuka, dan `save(id)` setelah entitasnya berhasil disimpan.
 */
export function useTranslationDraft(entityType: string) {
  const [draft, setDraft] = useState<TranslationDraft>({});
  const [original, setOriginal] = useState<TranslationDraft>({});

  const reset = useCallback(() => {
    setDraft({});
    setOriginal({});
  }, []);

  const load = useCallback(
    async (id: string) => {
      try {
        const r = await api<{ translations: TranslationDraft }>(`/translations/${entityType}/${id}`);
        setDraft(structuredClone(r.translations));
        setOriginal(structuredClone(r.translations));
      } catch {
        reset();
      }
    },
    [entityType, reset],
  );

  const setValue = useCallback((locale: string, field: string, value: string) => {
    setDraft((cur) => ({ ...cur, [locale]: { ...(cur[locale] ?? {}), [field]: value } }));
  }, []);

  /** Mengirim hanya yang berubah. Mengembalikan false bila gagal (entitas sudah tersimpan). */
  const save = useCallback(
    async (id: string): Promise<boolean> => {
      const changes: TranslationDraft = {};
      for (const [locale, fields] of Object.entries(draft)) {
        for (const [field, value] of Object.entries(fields)) {
          if ((original[locale]?.[field] ?? "") !== value.trim()) (changes[locale] ??= {})[field] = value.trim();
        }
      }
      if (Object.keys(changes).length === 0) return true;
      try {
        await api(`/translations/${entityType}/${id}`, { method: "PUT", json: { translations: changes } });
        return true;
      } catch {
        return false;
      }
    },
    [draft, original, entityType],
  );

  return useMemo(() => ({ draft, setValue, load, save, reset }), [draft, setValue, load, save, reset]);
}

export function TranslationFields({
  state,
  fields = ["name"],
}: {
  state: ReturnType<typeof useTranslationDraft>;
  fields?: Array<"name" | "description">;
}) {
  const t = useTranslations();
  const { business } = useAuth();
  const base = business?.defaultLocale ?? "id";
  const others = locales.filter((l) => l !== base);

  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{t("catalog.translations.title")}</legend>
      <p className="text-xs text-muted">{t("catalog.translations.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {others.map((locale) => (
          <div key={locale} className="space-y-2">
            <div className="text-xs font-medium text-muted">{localeLabels[locale as Locale]}</div>
            {fields.includes("name") ? (
              <Input
                aria-label={`${t("common.name")} (${localeLabels[locale as Locale]})`}
                dir={locale === "ar" ? "rtl" : "ltr"}
                placeholder={t("common.name")}
                maxLength={191}
                value={state.draft[locale]?.name ?? ""}
                onChange={(e) => state.setValue(locale, "name", e.target.value)}
              />
            ) : null}
            {fields.includes("description") ? (
              <Textarea
                aria-label={`${t("catalog.items.description")} (${localeLabels[locale as Locale]})`}
                dir={locale === "ar" ? "rtl" : "ltr"}
                placeholder={t("catalog.items.description")}
                maxLength={500}
                value={state.draft[locale]?.description ?? ""}
                onChange={(e) => state.setValue(locale, "description", e.target.value)}
              />
            ) : null}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
