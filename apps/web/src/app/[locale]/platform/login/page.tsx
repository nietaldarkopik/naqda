"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { Button, Card, Field, Input } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import { PlatformError, platformLogin } from "@/lib/platformApi";

export default function PlatformLoginPage() {
  const t = useTranslations("platformUi");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await platformLogin(email, password);
      router.replace("/platform");
    } catch (err) {
      setError(err instanceof PlatformError ? (err.status === 429 ? t("tooMany") : err.status === 401 ? t("invalidLogin") : err.message) : t("network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={48} />
            <div className="text-xl font-bold text-brand">{t("title")}</div>
          </div>
          <LanguageSwitcher />
        </div>
        <Card className="p-6">
          <h1 className="mb-4 text-lg font-semibold">{t("loginTitle")}</h1>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label={t("email")}>{(id) => <Input id={id} type="email" dir="ltr" className="text-start" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="platform-email" />}</Field>
            <Field label={t("password")}>{(id) => <Input id={id} type="password" dir="ltr" className="text-start" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="platform-password" />}</Field>
            {error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="platform-login-error">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || !email || !password} data-testid="platform-submit">
              {busy ? t("loading") : t("signIn")}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
