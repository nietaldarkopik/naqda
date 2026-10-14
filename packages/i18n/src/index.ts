import id from "./messages/id.json" with { type: "json" };
import en from "./messages/en.json" with { type: "json" };
import ar from "./messages/ar.json" with { type: "json" };
import { defaultLocale, type Locale } from "./locales";

export * from "./locales";

export type Messages = typeof id;

export const catalogs: Record<Locale, Messages> = { id, en: en as Messages, ar: ar as Messages };

export const getMessages = (locale: Locale): Messages => catalogs[locale] ?? catalogs[defaultLocale];

/** Daftar kunci bertitik ("auth.title") dari katalog bersarang. */
export const flattenKeys = (obj: Record<string, unknown>, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? flattenKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const lookup = (obj: unknown, path: string): string | undefined => {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
};

/** Terjemahan sisi server (mis. pesan error). Kunci hilang jatuh ke en, lalu id. */
export const translate = (locale: Locale, key: string, params: Record<string, string | number> = {}): string => {
  const raw = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? lookup(catalogs.id, key) ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};
