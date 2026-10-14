import { getRequestConfig } from "next-intl/server";
import { getMessages, isLocale, defaultLocale } from "@naqdi/i18n";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) && routing.locales.includes(requested) ? requested : defaultLocale;
  return { locale, messages: getMessages(locale) };
});
