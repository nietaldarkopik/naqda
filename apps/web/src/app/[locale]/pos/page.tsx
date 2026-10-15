import { setRequestLocale } from "next-intl/server";
import { PosApp } from "@/components/pos/PosApp";

export default async function PosPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <PosApp />;
}
