export const locales = ["id", "en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "id";

export type Direction = "ltr" | "rtl";

const rtl = new Set<Locale>(["ar"]);

export const localeDir = (locale: Locale): Direction => (rtl.has(locale) ? "rtl" : "ltr");

/** Nama bahasa ditulis dalam bahasanya sendiri, agar mudah dikenali pengguna. */
export const localeLabels: Record<Locale, string> = {
  id: "Bahasa Indonesia",
  en: "English",
  ar: "العربية",
};

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

/** Tag BCP 47 untuk Intl. Digit Latin dipaksa agar nominal tidak ambigu (doc 02, bagian 1c). */
export const intlTags: Record<Locale, string> = {
  id: "id-ID",
  en: "en-US",
  ar: "ar-u-nu-latn",
};
