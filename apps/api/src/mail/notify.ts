import { and, asc, eq, isNull } from "drizzle-orm";
import { businesses, roles, users, type DbHandle } from "@naqdi/db";
import { isLocale, type Locale } from "@naqdi/i18n";
import type { Config } from "../config";
import { enqueueMail } from "./queue";

type Db = DbHandle["db"];

const planName = (plan: string) => (plan === "basic" ? "Starter" : plan === "pro" ? "Pro" : plan === "unlimited" ? "Enterprise" : plan);

/** Penerima email bisnis: administrator tertua (pemilik) dan bahasa bawaan bisnis. */
const contactOf = async (db: Db, businessId: string): Promise<{ name: string; email: string; business: string; locale: Locale } | null> => {
  const [row] = await db
    .select({ name: users.name, email: users.email, business: businesses.name, locale: businesses.defaultLocale })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(businesses, eq(users.businessId, businesses.id))
    .where(and(eq(users.businessId, businessId), isNull(users.deletedAt), eq(roles.systemKey, "administrator")))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!row) return null;
  return { name: row.name, email: row.email, business: row.business, locale: isLocale(row.locale) ? row.locale : "id" };
};

export interface InvoiceFacts {
  number: string;
  plan: string;
  interval: "monthly" | "yearly";
  amount: number;
  currency: string;
  dueAt: Date | null;
}

const date = (d: Date | null, locale: Locale) => (d ? new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(d) : "-");

/** Pemberitahuan ke pemilik bisnis. Semuanya aman dipanggil tanpa await bermasalah: enqueueMail tidak pernah melempar. */
export const mailWelcome = async (db: Db, config: Config, businessId: string, trialDays: number): Promise<void> => {
  const c = await contactOf(db, businessId);
  if (!c) return;
  await enqueueMail(db, { to: c.email, kind: "welcome", locale: c.locale, businessId, data: { name: c.name, business: c.business, trialDays, loginUrl: `${config.mail.appUrl}/${c.locale}/login` } });
};

export const mailInvoiceIssued = async (db: Db, config: Config, businessId: string, inv: InvoiceFacts): Promise<void> => {
  const c = await contactOf(db, businessId);
  if (!c) return;
  await enqueueMail(db, {
    to: c.email,
    kind: "invoice_issued",
    locale: c.locale,
    businessId,
    data: { name: c.name, business: c.business, number: inv.number, plan: planName(inv.plan), interval: inv.interval, amount: inv.amount, currency: inv.currency, dueDate: date(inv.dueAt, c.locale), billingUrl: `${config.mail.appUrl}/${c.locale}/settings/billing`, bankInfo: config.billingBankInfo || null },
  });
};

/** Ke pengelola (OPERATOR_EMAIL), bukan ke pelanggan. Bahasa Indonesia. */
export const mailProofReceived = async (db: Db, config: Config, businessId: string, inv: Pick<InvoiceFacts, "number" | "amount" | "currency">): Promise<void> => {
  if (!config.mail.operatorEmail) return;
  const c = await contactOf(db, businessId);
  await enqueueMail(db, { to: config.mail.operatorEmail, kind: "proof_received", locale: "id", businessId, data: { business: c?.business ?? businessId, number: inv.number, amount: inv.amount, currency: inv.currency, reviewUrl: `${config.mail.appUrl}/id/platform/invoices` } });
};

export const mailPaymentApproved = async (db: Db, config: Config, businessId: string, number: string, periodEnd: Date): Promise<void> => {
  const c = await contactOf(db, businessId);
  if (!c) return;
  await enqueueMail(db, { to: c.email, kind: "payment_approved", locale: c.locale, businessId, data: { name: c.name, business: c.business, number, periodEnd: date(periodEnd, c.locale), billingUrl: `${config.mail.appUrl}/${c.locale}/settings/billing` } });
};

export const mailPaymentRejected = async (db: Db, config: Config, businessId: string, number: string, reason: string): Promise<void> => {
  const c = await contactOf(db, businessId);
  if (!c) return;
  await enqueueMail(db, { to: c.email, kind: "payment_rejected", locale: c.locale, businessId, data: { name: c.name, business: c.business, number, reason, billingUrl: `${config.mail.appUrl}/${c.locale}/settings/billing` } });
};
