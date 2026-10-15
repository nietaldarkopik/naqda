import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Link } from "@/i18n/navigation";

/**
 * Halaman ketentuan layanan dan kebijakan privasi. PENGISI SEMENTARA: teksnya menyatakan dengan jelas bahwa ini draf dan belum
 * ditinjau konsultan hukum. Ganti dengan dokumen sungguhan SEBELUM pendaftaran dibuka untuk publik.
 */
export default async function LegalPage({ params }: { params: Promise<{ locale: string; doc: string }> }) {
  const { locale, doc } = await params;
  if (doc !== "terms" && doc !== "privacy") notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "legal" });
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Logo size={40} />
        <h1 className="text-xl font-semibold">{t(doc === "terms" ? "termsTitle" : "privacyTitle")}</h1>
      </div>
      <p role="note" className="rounded-lg bg-warn-soft p-4 text-sm font-medium" data-testid="legal-draft">
        {t("draft")}
      </p>
      <p className="text-sm text-muted">{t(doc === "terms" ? "termsBody" : "privacyBody")}</p>
      <Link href="/register" className="text-sm font-medium text-brand underline">
        {t("back")}
      </Link>
    </div>
  );
}
