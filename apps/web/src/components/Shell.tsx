"use client";

import { BillingBanner } from "@/components/BillingBanner";
import { Logo } from "@/components/Logo";
import {
  Activity,
  BarChart3,
  Bell,
  ShieldCheck,
  Boxes,
  Carrot,
  History,
  Layers,
  Package,
  Percent,
  Receipt,
  ShoppingBag,
  Tag,
  Tags,
  Ticket,
  Truck,
  Wrench,
  ChevronRight,
  CreditCard,
  Gift,
  Globe,
  LayoutDashboard,
  Library,
  LogOut,
  MessageSquare,
  Settings,
  Store,
  Table2,
  Tablet,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { canOpen } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface NavItem {
  key: string;
  href?: string;
  icon: LucideIcon;
  children?: NavItem[];
  /** Hanya tampil bila pengguna punya hak ini. */
  privilege?: string;
  /** Atau bila pengguna punya salah satu hak ini. */
  any?: string[];
}

// Hanya halaman yang sudah dibangun yang punya href. Sisanya tampil nonaktif ("Segera hadir").
const nav: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    key: "reports",
    icon: BarChart3,
    privilege: "reports.view",
    children: [
      { key: "rSummary", href: "/reports/summary", icon: BarChart3 },
      { key: "rTransactions", href: "/reports/transactions", icon: Receipt },
      { key: "rShifts", href: "/reports/shifts", icon: Wallet },
      { key: "rPayments", href: "/reports/payments", icon: CreditCard },
      { key: "rSalesTypes", href: "/reports/sales-types", icon: Truck },
      { key: "rItems", href: "/reports/items", icon: ShoppingBag },
      { key: "rCategories", href: "/reports/categories", icon: Tags },
      { key: "rBrands", href: "/reports/brands", icon: Tag },
      { key: "rModifiers", href: "/reports/modifiers", icon: Layers },
      { key: "rDiscounts", href: "/reports/discounts", icon: Percent },
      { key: "rTaxes", href: "/reports/taxes", icon: Receipt },
      { key: "rGratuity", href: "/reports/gratuity", icon: Wrench },
      { key: "rCollectedBy", href: "/reports/collected-by", icon: Users },
      { key: "rTables", href: "/reports/tables", icon: Table2 },
      { key: "rOutlets", href: "/reports/outlets", icon: Store },
    ],
  },
  {
    key: "library",
    icon: Library,
    children: [
      { key: "items", href: "/items", icon: ShoppingBag },
      { key: "modifiers", href: "/modifiers", icon: Layers },
      { key: "categories", href: "/categories", icon: Tags },
      { key: "bundles", href: "/bundles", icon: Package },
      { key: "promos", href: "/promos", icon: Ticket },
      { key: "discounts", href: "/discounts", icon: Percent },
      { key: "taxes", href: "/taxes", icon: Receipt },
      { key: "gratuities", href: "/gratuities", icon: Wrench },
      { key: "salesTypes", href: "/sales-types", icon: Truck },
      { key: "brands", href: "/brands", icon: Tag },
    ],
  },
  {
    key: "ingredient",
    icon: Carrot,
    any: ["inventory.manage", "reports.view"],
    children: [
      { key: "iIngredients", href: "/ingredients", icon: Carrot },
      { key: "iRecipes", href: "/recipes", icon: Layers },
    ],
  },
  {
    key: "inventory",
    icon: Boxes,
    any: ["inventory.manage", "reports.view"],
    children: [
      { key: "iStock", href: "/inventory/stock", icon: Boxes },
      { key: "iPo", href: "/inventory/purchase-orders", icon: Receipt },
      { key: "iTransfers", href: "/inventory/transfers", icon: Truck },
      { key: "iAdjustments", href: "/inventory/adjustments", icon: Wrench },
      { key: "iSuppliers", href: "/suppliers", icon: Store },
      { key: "iSummary", href: "/reports/inventory", icon: BarChart3 },
    ],
  },
  { key: "onlineChannels", icon: Globe },
  {
    key: "customers",
    icon: UserRound,
    any: ["customers.manage", "reports.view"],
    children: [
      { key: "cList", href: "/customers", icon: UserRound },
      { key: "cLoyalty", href: "/loyalty", icon: Gift },
      { key: "cFeedback", href: "/feedback", icon: MessageSquare },
    ],
  },
  { key: "outlets", href: "/outlets", icon: Store },
  { key: "employees", href: "/employees", icon: Users, privilege: "employees.manage" },
  { key: "roles", href: "/roles", icon: ShieldCheck, privilege: "employees.manage" },
  { key: "tableManagement", href: "/tables", icon: Table2, privilege: "tables.manage" },
  { key: "payments", icon: CreditCard },
  {
    key: "accountSettings",
    icon: Settings,
    privilege: "settings.manage",
    children: [
      { key: "aCheckout", href: "/settings/checkout", icon: ShoppingBag },
      { key: "aReceipt", href: "/settings/receipt", icon: Receipt },
      { key: "aPayments", href: "/settings/payments", icon: CreditCard },
      { key: "aNotifications", href: "/settings/notifications", icon: Bell },
      { key: "aBilling", href: "/settings/billing", icon: Wallet },
      { key: "aAccount", href: "/settings/account", icon: Settings },
    ],
  },
  { key: "activities", href: "/activities", icon: Activity, privilege: "reports.view" },
  { key: "devices", href: "/devices", icon: Tablet, privilege: "settings.manage" },
  { key: "audit", href: "/audit", icon: History, privilege: "settings.manage" },
];

const isActive = (pathname: string, href?: string) => (href ? pathname === href || pathname.startsWith(`${href}/`) : false);

export function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { status, user, business, logout, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="grid min-h-screen place-items-center text-muted" role="status">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-side text-side-text">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo size={36} framed />
          <div className="min-w-0">
            <div className="text-xl font-bold tracking-wide text-white">{t("app.name")}</div>
            <div className="truncate text-xs opacity-70">{business?.name}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Menu">
          {nav.filter((entry) => (!entry.privilege || can(entry.privilege)) && (!entry.any || entry.any.some(can))).map((entry) => {
            const { key, href, icon: Icon, children } = entry;
            const label = t(`nav.${key}`);
            const base = "flex items-center gap-3 rounded-md px-3 py-2 text-sm";
            if (children) {
              const open = children.some((c) => isActive(pathname, c.href));
              return (
                <details key={key} open={open} className="group">
                  <summary className={`${base} cursor-pointer list-none hover:bg-side-active/60 [&::-webkit-details-marker]:hidden`}>
                    <Icon size={17} aria-hidden />
                    <span className="flex-1">{label}</span>
                    <ChevronRight size={14} className="transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="ms-4 mt-0.5 space-y-0.5 border-s border-white/10 ps-2">
                    {children.map((c) => {
                      const active = isActive(pathname, c.href);
                      return (
                        <Link
                          key={c.key}
                          href={c.href!}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] ${active ? "bg-side-active font-medium text-white" : "hover:bg-side-active/60"}`}
                        >
                          <c.icon size={15} aria-hidden />
                          <span>{t(`nav.${c.key}`)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </details>
              );
            }
            const active = isActive(pathname, href);
            if (!href) {
              return (
                <div key={key} className={`${base} cursor-not-allowed opacity-45`} title={t("nav.comingSoon")} aria-disabled="true">
                  <Icon size={17} aria-hidden />
                  <span className="flex-1">{label}</span>
                </div>
              );
            }
            return (
              <Link
                key={key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`${base} ${active ? "bg-side-active font-medium text-white" : "hover:bg-side-active/60"}`}
              >
                <Icon size={17} aria-hidden />
                <span className="flex-1">{label}</span>
                {active ? <ChevronRight size={14} className="rtl:rotate-180" aria-hidden /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          <LanguageSwitcher tone="dark" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{user.name}</div>
            <div className="ltr-text max-w-full truncate text-xs opacity-70">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-side-active"
          >
            <LogOut size={16} className="rtl:-scale-x-100" aria-hidden />
            {t("common.logout")}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 lg:p-8">
        <BillingBanner />
        {canOpen(pathname, can) ? children : <p className="rounded-lg bg-warn-soft p-4" role="alert" data-testid="forbidden-page">{t("errors.forbidden")}</p>}
      </main>
    </div>
  );
}
