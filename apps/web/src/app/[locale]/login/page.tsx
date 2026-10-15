"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { Button, Card, Field, Input } from "@/components/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const { status, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError && err.code !== "network" ? err.message : t("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={56} />
            <div>
              <div className="text-2xl font-bold text-brand">{t("app.name")}</div>
              <div className="text-sm text-muted">{t("app.tagline")}</div>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <Card className="p-6">
          <h1 className="mb-4 text-lg font-semibold">{t("auth.title")}</h1>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label={t("auth.email")}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  className="text-start"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t("auth.password")}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  className="text-start"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
            {error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || !email || !password}>
              {busy ? t("common.loading") : t("auth.submit")}
            </Button>
          </form>
        </Card>
        <p className="text-center text-sm text-muted">
          {t("login.noAccount")}{" "}
          <Link href="/register" className="font-medium text-brand underline" data-testid="login-register-link">
            {t("login.registerFree")}
          </Link>
        </p>
      </div>
    </div>
  );
}
