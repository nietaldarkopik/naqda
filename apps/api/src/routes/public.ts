import { and, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createBusiness, isValidTimezone, users, type DbHandle } from "@naqdi/db";
import { TRIAL_DAYS, isSupportedCurrency, supportedCurrencies, trialEndFrom } from "@naqdi/domain";
import { WindowLimiter } from "../auth/window";
import type { Config } from "../config";
import { AppError } from "../errors";
import { clientIp, validate } from "../http";

type Db = DbHandle["db"];

/** Versi ketentuan layanan yang disetujui saat mendaftar. Naikkan saat dokumennya berubah (disimpan per bisnis). */
export const TERMS_VERSION = "2026-10-draft";

/** Batas pendaftaran: per alamat IP dan total, per jam. Hanya pagar kasar; verifikasi email adalah pagar sebenarnya (belum ada). */
const PER_IP = 5;
const GLOBAL = 300;
const HOUR = 3_600_000;

const signupBody = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(191),
  password: z.string().min(10).max(200),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  currency: z.string().trim().toUpperCase().refine(isSupportedCurrency, "signup.currencyUnsupported"),
  timezone: z.string().trim().max(64).refine(isValidTimezone, "signup.timezoneInvalid"),
  locale: z.enum(["id", "en", "ar"]).default("id"),
  acceptTerms: z.literal(true, { message: "signup.termsRequired" }),
  /** Kolom jebakan: manusia tidak melihatnya, robot mengisinya. */
  website: z.string().max(200).optional(),
});

/** Rute tanpa login: konfigurasi untuk halaman daftar dan pendaftaran mandiri bisnis baru. */
export const publicRoutes = (db: Db, config: Config) => {
  const app = new Hono();
  const perIp = new WindowLimiter(PER_IP, HOUR);
  const everyone = new WindowLimiter(GLOBAL, HOUR);

  app.get("/config", (c) =>
    c.json({
      signupEnabled: config.signupEnabled,
      trialDays: TRIAL_DAYS,
      termsVersion: TERMS_VERSION,
      currencies: supportedCurrencies,
    }),
  );

  app.post("/signup", validate("json", signupBody), async (c) => {
    if (!config.signupEnabled) throw new AppError("forbidden", { messageKey: "signup.disabled" });
    const b = c.req.valid("json");

    // Robot mengisi kolom jebakan: pura-pura berhasil agar tidak belajar menyiasatinya, tanpa membuat apa pun.
    if (b.website) return c.json({ ok: true }, 201);

    if (!everyone.allow("all") || !perIp.allow(clientIp(c, config.trustProxyHops))) throw new AppError("rate_limited");

    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`LOWER(${users.email}) = ${b.email}`, isNull(users.deletedAt)))
      .limit(1);
    if (taken) throw new AppError("conflict", { fields: { email: "signup.emailTaken" } });

    const now = new Date();
    try {
      await createBusiness(db, {
        name: b.businessName,
        currency: b.currency,
        defaultLocale: b.locale,
        timezone: b.timezone,
        plan: "basic",
        status: "trial",
        trialEndsAt: trialEndFrom(now),
        country: b.country ?? null,
        termsAcceptedAt: now,
        termsVersion: TERMS_VERSION,
        adminEmail: b.email,
        adminName: b.ownerName,
        adminPassword: b.password,
        bcryptCost: config.bcryptCost,
      });
    } catch (e) {
      // Dua pendaftaran serentak dengan email sama: yang kalah mendapat pesan yang sama dengan pengecekan di atas.
      if (/Duplicate entry|ER_DUP_ENTRY/.test(e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "")) {
        throw new AppError("conflict", { fields: { email: "signup.emailTaken" } });
      }
      throw e;
    }
    return c.json({ ok: true, trialDays: TRIAL_DAYS }, 201);
  });

  return app;
};
