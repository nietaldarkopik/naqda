import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defaultDatabaseUrl, loadEnv } from "@naqdi/db";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default(defaultDatabaseUrl),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET minimal 32 karakter"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  BCRYPT_COST: z.coerce.number().int().min(4).max(14).default(10),
  POS_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
  /** Jumlah proxy tepercaya di depan API yang menambahkan alamat ke X-Forwarded-For (dev: Next = 1; Apache + Next = 2). 0 = abaikan header. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Pendaftaran mandiri. Bawaan: aktif di dev/tes, MATI di produksi sampai pemilik menyalakannya (butuh verifikasi email sebelum dibuka ke publik). */
  SIGNUP_ENABLED: z.enum(["true", "false"]).optional(),
  /** Petunjuk transfer bank yang ditampilkan di faktur (rekening resmi Naqdi). Pakai backslash-n untuk baris baru. Kosong = pelanggan diminta menghubungi pengelola. */
  BILLING_BANK_INFO: z.string().default(""),
  /** Email keluar. Tanpa SMTP_HOST pesan hanya dicatat (driver "log"); isi SMTP_* untuk mengirim sungguhan (Google, Zoho, Brevo, dan lain-lain). */
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** true = TLS langsung (port 465); false = STARTTLS bila server mendukung (port 587). */
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("Naqdi <no-reply@localhost>"),
  MAIL_REPLY_TO: z.string().default(""),
  /** Penerima pemberitahuan untuk pengelola (mis. bukti transfer masuk). Kosong = tidak ada pemberitahuan. */
  OPERATOR_EMAIL: z.string().default(""),
  /** Alamat publik aplikasi web, dipakai untuk tautan di email. */
  APP_URL: z.string().default("http://localhost:3000"),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  host: string;
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  bcryptCost: number;
  posTokenTtlSeconds: number;
  isProduction: boolean;
  storageDir: string;
  trustProxyHops: number;
  signupEnabled: boolean;
  billingBankInfo: string;
  mail: {
    driver: "smtp" | "log";
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    replyTo: string;
    operatorEmail: string;
    appUrl: string;
  };
}

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));

const placeholderSecret = "ganti-dengan-rahasia-acak-minimal-32-karakter";

export const parseConfig = (env: Record<string, string | undefined>): Config => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Konfigurasi tidak valid: ${detail}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && e.JWT_SECRET === placeholderSecret) {
    throw new Error("JWT_SECRET masih memakai nilai contoh. Ganti dengan rahasia acak sebelum produksi.");
  }
  if (e.STORAGE_DRIVER === "s3") {
    throw new Error("STORAGE_DRIVER=s3 belum didukung. Gunakan local.");
  }
  return {
    storageDir: path.resolve(rootDir, e.STORAGE_DIR),
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    jwtSecret: e.JWT_SECRET,
    accessTtlSeconds: e.ACCESS_TOKEN_TTL_MIN * 60,
    refreshTtlSeconds: e.REFRESH_TOKEN_TTL_DAYS * 24 * 3600,
    bcryptCost: e.BCRYPT_COST,
    posTokenTtlSeconds: e.POS_TOKEN_TTL_HOURS * 3600,
    isProduction: e.NODE_ENV === "production",
    trustProxyHops: e.TRUST_PROXY_HOPS,
    billingBankInfo: e.BILLING_BANK_INFO.replace(/\\n/g, "\n").trim(),
    mail: {
      driver: e.SMTP_HOST ? "smtp" : "log",
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE === "true",
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.MAIL_FROM,
      replyTo: e.MAIL_REPLY_TO,
      operatorEmail: e.OPERATOR_EMAIL,
      appUrl: e.APP_URL.replace(/\/+$/, ""),
    },
    signupEnabled: e.SIGNUP_ENABLED ? e.SIGNUP_ENABLED === "true" : e.NODE_ENV !== "production",
  };
};

export const loadConfig = (): Config => {
  loadEnv();
  return parseConfig(process.env);
};
