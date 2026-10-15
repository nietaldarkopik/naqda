import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Log terstruktur: satu objek JSON per baris di stdout, siap dibaca pengumpul log (journald, Docker, Loki, dll).
 * Yang dicatat: waktu, tingkat, id permintaan, metode, path TANPA query string, status, durasi. Yang TIDAK pernah dicatat:
 * isi permintaan/jawaban, header (token), query string, dan alamat IP pengguna.
 */
export type Level = "info" | "warn" | "error";

export const logLine = (level: Level, msg: string, fields: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): void => {
  sink(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
};

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Memberi setiap permintaan id (dari header X-Request-Id bila sah) dan mencatat satu baris akses saat selesai. */
export const requestLogger =
  (enabled: boolean, sink?: (line: string) => void): MiddlewareHandler =>
  async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    c.set("requestId" as never, id as never);
    c.header("x-request-id", id);
    const start = performance.now();
    await next();
    if (!enabled) return;
    const status = c.res.status;
    logLine(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
      requestId: id,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status,
      ms: Math.round(performance.now() - start),
    }, sink);
  };
