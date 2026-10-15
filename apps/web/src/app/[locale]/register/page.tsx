"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { countries, countryInfo, guessCountry, supportedCurrencies } from "@naqdi/domain";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface PublicConfig {
  signupEnabled: boolean;
  trialDays: number;
}

/** Pendaftaran mandiri: bisnis baru dengan uji coba gratis, lalu langsung masuk ke Back Office. */
export default function RegisterPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { status, login } = useAuth();
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [form, setForm] = useState({
    businessName: "",
    ownerName: "",
    email: "",
    password: "",
    country: "ID",
    currency: "IDR",
    timezone: "Asia/Jakarta",
    acceptTerms: false,
    website: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  useEffect(() => {
    fetch("/api/v1/public/config")
      .then((r) => r.json() as Promise<PublicConfig>)
      .then(setCfg)
      .catch(() => setCfg({ signupEnabled: true, trialDays: 14 }));
    // Tebakan awal dari zona waktu peramban; semuanya tetap bisa diubah.
    const guess = guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (guess) setForm((f) => ({ ...f, country: guess.code, currency: guess.currency, timezone: guess.timezone }));
  }, []);

  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const currencyNames = useMemo(() => new Intl.DisplayNames([locale], { type: "currency" }), [locale]);
  const timezones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [form.timezone];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickCountry = (code: string) => {
    const c = countryInfo(code);
    setForm((f) => ({ ...f, country: code, ...(c ? { currency: c.currency, timezone: c.timezone } : {}) }));
  };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError("");
    try {
      const res = await fetch("/api/v1/public/signup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-locale": locale },
        body: JSON.stringify({ ...form, locale, website: form.website || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; fields?: Record<string, string> };
        if (data.fields) setErrors(data.fields);
        setFormError(data.fields ? "" : (data.message ?? t("errors.server")));
        return;
      }
      await login(form.email, form.password);
      router.replace("/dashboard");
    } catch (err) {
      setFormError(err instanceof ApiError && err.code !== "network" ? err.message : t("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const disabled = cfg !== null && !cfg.signupEnabled;
  const days = cfg?.trialDays ?? 14;

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-lg space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={56} />
            <div>
              <div className="text-2xl font-bold text-brand">{t("app.name")}</div>
              <div className="text-sm text-muted">{t("register.trialNote", { days })}</div>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <Card className="p-6">
          <h1 className="mb-1 text-lg font-semibold">{t("register.title")}</h1>
          {disabled ? (
            <p role="status" className="rounded-md bg-warn-soft px-3 py-3 text-sm" data-testid="signup-disabled">
              {t("signup.disabled")}
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate data-testid="register-form">
              <Field label={t("register.businessName")} error={errors.businessName}>
                {(id) => <Input id={id} value={form.businessName} maxLength={120} autoComplete="organization" onChange={(e) => set("businessName", e.target.value)} invalid={Boolean(errors.businessName)} required />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("register.ownerName")} error={errors.ownerName}>
                  {(id) => <Input id={id} value={form.ownerName} maxLength={120} autoComplete="name" onChange={(e) => set("ownerName", e.target.value)} invalid={Boolean(errors.ownerName)} required />}
                </Field>
                <Field label={t("auth.email")} error={errors.email}>
                  {(id) => <Input id={id} type="email" dir="ltr" className="text-start" value={form.email} maxLength={191} autoComplete="email" onChange={(e) => set("email", e.target.value)} invalid={Boolean(errors.email)} required />}
                </Field>
              </div>
              <Field label={t("auth.password")} hint={t("register.passwordHint")} error={errors.password}>
                {(id) => <Input id={id} type="password" dir="ltr" className="text-start" value={form.password} maxLength={200} autoComplete="new-password" onChange={(e) => set("password", e.target.value)} invalid={Boolean(errors.password)} required />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("register.country")} error={errors.country}>
                  {(id) => (
                    <Select id={id} value={form.country} onChange={(e) => pickCountry(e.target.value)} data-testid="register-country">
                      {[...countries].sort((a, b) => (regionNames.of(a.code) ?? a.code).localeCompare(regionNames.of(b.code) ?? b.code, locale)).map((c) => (
                        <option key={c.code} value={c.code}>
                          {regionNames.of(c.code) ?? c.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t("register.currency")} hint={t("register.currencyHint")} error={errors.currency}>
                  {(id) => (
                    <Select id={id} value={form.currency} onChange={(e) => set("currency", e.target.value)} data-testid="register-currency">
                      {supportedCurrencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {currencyNames.of(c.code) ?? c.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field label={t("register.timezone")} error={errors.timezone}>
                {(id) => (
                  <>
                    <Input id={id} dir="ltr" className="text-start" list="register-timezones" value={form.timezone} maxLength={64} onChange={(e) => set("timezone", e.target.value)} invalid={Boolean(errors.timezone)} data-testid="register-timezone" />
                    <datalist id="register-timezones">
                      {timezones.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              {/* Kolom jebakan untuk robot: tersembunyi dari manusia dan pembaca layar. */}
              <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
                </label>
              </div>
              <div className="space-y-1">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} data-testid="register-terms" />
                  <span>
                    {t.rich("register.terms", {
                      terms: (chunks) => (
                        <Link href="/legal/terms" target="_blank" className="font-medium text-brand underline">
                          {chunks}
                        </Link>
                      ),
                      privacy: (chunks) => (
                        <Link href="/legal/privacy" target="_blank" className="font-medium text-brand underline">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </span>
                </label>
                {errors.acceptTerms ? (
                  <p role="alert" className="text-xs text-danger">
                    {errors.acceptTerms}
                  </p>
                ) : null}
              </div>
              {formError ? (
                <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" className="h-11 w-full" disabled={busy || !form.acceptTerms || !form.businessName || !form.ownerName || !form.email || form.password.length < 10} data-testid="register-submit">
                {busy ? t("common.loading") : t("register.submit", { days })}
              </Button>
            </form>
          )}
        </Card>
        <p className="text-center text-sm text-muted">
          {t("register.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-brand underline">
            {t("auth.submit")}
          </Link>
        </p>
      </div>
    </div>
  );
}
