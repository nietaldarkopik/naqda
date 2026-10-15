import type { Context } from "hono";
import { isLocale, translate, type Locale, defaultLocale } from "@naqdi/i18n";

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "no_backoffice_access"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "locked"
  | "server";

/** Pemetaan kode ke status HTTP dan kunci terjemahan pesan. */
const meta: Record<ErrorCode, { status: 400 | 401 | 403 | 404 | 409 | 422 | 423 | 429 | 500; key: string }> = {
  unauthorized: { status: 401, key: "errors.unauthorized" },
  forbidden: { status: 403, key: "errors.forbidden" },
  no_backoffice_access: { status: 403, key: "auth.noAccess" },
  not_found: { status: 404, key: "errors.notFound" },
  validation: { status: 422, key: "errors.validation" },
  conflict: { status: 409, key: "errors.conflict" },
  rate_limited: { status: 429, key: "auth.tooMany" },
  locked: { status: 423, key: "pos.pinLocked" },
  server: { status: 500, key: "errors.server" },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly messageKey: string;
  /** Data tambahan untuk klien (mis. sisa detik penguncian). */
  readonly extra: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, options: { fields?: Record<string, string>; messageKey?: string; extra?: Record<string, unknown> } = {}) {
    super(code);
    this.code = code;
    this.extra = options.extra;
    this.fields = options.fields;
    this.messageKey = options.messageKey ?? meta[code].key;
  }

  get status() {
    return meta[this.code].status;
  }
}

/** Bahasa respons: header X-Locale, lalu Accept-Language, lalu default. */
export const requestLocale = (c: Context): Locale => {
  const explicit = c.req.header("x-locale");
  if (isLocale(explicit)) return explicit;
  const accept = c.req.header("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export const errorBody = (c: Context, err: AppError): ErrorBody => {
  const locale = requestLocale(c);
  const body: ErrorBody = { code: err.code, message: translate(locale, err.messageKey), ...(err.extra ? { extra: err.extra } : {}) };
  if (err.fields) {
    body.fields = Object.fromEntries(
      Object.entries(err.fields).map(([field, key]) => [field, key.includes(".") ? translate(locale, key) : key]),
    );
  }
  return body;
};

/** Mengenali galat duplikat MySQL (kode ER_DUP_ENTRY) dan mengembalikan nama indeksnya. */
export const duplicateKey = (error: unknown): string | null => {
  let cur: unknown = error;
  for (let depth = 0; depth < 4 && cur; depth++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "ER_DUP_ENTRY") {
      const match = /for key '([^']+)'/.exec(e.message ?? "");
      return match?.[1] ?? "unknown";
    }
    cur = e.cause;
  }
  return null;
};
