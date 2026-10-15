import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { localeDir, type Locale } from "@naqdi/i18n";
import { ToastProvider } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { AuthProvider } from "@/lib/auth";
import "../globals.css";

export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

export const viewport: Viewport = { themeColor: "#0f766e", width: "device-width", initialScale: 1, viewportFit: "cover" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return {
    title: { default: t("name"), template: `%s | ${t("name")}` },
    description: t("tagline"),
    manifest: "/manifest.webmanifest",
    icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/logo.png", sizes: "96x96", type: "image/png" }], apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Naqdi", statusBarStyle: "default" },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={localeDir(locale as Locale)}>
      <body>
        <NextIntlClientProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
