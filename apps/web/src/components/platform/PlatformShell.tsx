"use client";

import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { Badge, Button } from "@/components/ui";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { platformSession, usePlatformSession } from "@/lib/platformApi";

/** Kerangka panel pengelola: terpisah dari Back Office toko. Halaman selain /platform/login butuh sesi pengelola. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const t = useTranslations("platformUi");
  const router = useRouter();
  const pathname = usePathname();
  const { ready, admin, logout } = usePlatformSession(pathname);
  const onLogin = pathname.endsWith("/platform/login");

  useEffect(() => {
    if (ready && !admin && !onLogin && !platformSession()) router.replace("/platform/login");
  }, [ready, admin, onLogin, router]);

  if (onLogin) return <>{children}</>;
  if (!ready || !admin) return <div className="grid min-h-screen place-items-center text-muted">{t("loading")}</div>;

  const nav = [
    { href: "/platform", label: t("navOverview") },
    { href: "/platform/businesses", label: t("navBusinesses") },
    { href: "/platform/audit", label: t("navAudit") },
  ];
  const active = (href: string) => (href === "/platform" ? pathname.endsWith("/platform") : pathname.includes(href));

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Logo size={34} />
            <div className="font-semibold">{t("title")}</div>
            <nav className="ms-4 flex gap-1" aria-label="Platform">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 text-sm font-medium ${active(n.href) ? "bg-brand-soft text-brand-strong" : "text-muted hover:bg-surface-2"}`}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <LanguageSwitcher />
            <span className="hidden sm:inline" data-testid="platform-admin">
              {admin.name}
            </span>
            <Badge tone={admin.role === "owner" ? "good" : "neutral"}>{t(admin.role === "owner" ? "roleOwner" : "roleSupport")}</Badge>
            <Button
              variant="ghost"
              onClick={() => {
                logout();
                router.replace("/platform/login");
              }}
            >
              {t("logout")}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">{children}</main>
    </div>
  );
}
