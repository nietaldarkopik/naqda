"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Klien API panel pengelola. Token pengelola TERPISAH dari sesi toko: disimpan di sessionStorage (hilang saat tab ditutup),
 * berumur 8 jam, tanpa pembaruan otomatis (habis = masuk lagi). Tidak memakai AuthProvider toko sama sekali.
 */
const KEY = "naqdi.platform.session";

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  role: "owner" | "support";
}
interface Stored {
  token: string;
  admin: PlatformAdmin;
  expiresAt: number;
}

export class PlatformError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const read = (): Stored | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (s.expiresAt < Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
};
export const platformSession = (): Stored | null => read();
export const platformLogout = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* abaikan */
  }
};

export async function platformLogin(email: string, password: string): Promise<PlatformAdmin> {
  const res = await fetch("/api/v1/platform/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-locale": document.documentElement.lang || "id" }, body: JSON.stringify({ email, password }) });
  const data = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; admin?: PlatformAdmin; code?: string; message?: string };
  if (!res.ok || !data.accessToken || !data.admin) throw new PlatformError(res.status, data.code ?? "server", data.message ?? "error");
  sessionStorage.setItem(KEY, JSON.stringify({ token: data.accessToken, admin: data.admin, expiresAt: Date.now() + (data.expiresIn ?? 28_800) * 1000 - 60_000 } satisfies Stored));
  return data.admin;
}

export async function platformApi<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const s = read();
  const headers: Record<string, string> = { "x-locale": document.documentElement.lang || "id" };
  if (s) headers.authorization = `Bearer ${s.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api/v1/platform${path}`, { method: init.method ?? "GET", headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) });
  } catch {
    throw new PlatformError(0, "network", "network");
  }
  if (res.ok) return (await res.json()) as T;
  const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string; fields?: Record<string, string>; extra?: Record<string, unknown> };
  if (res.status === 401) platformLogout();
  throw new PlatformError(res.status, data.code ?? "server", data.message ?? res.statusText, data.fields, data.extra);
}

/** Sesi pengelola saat ini; `ready` false sampai dibaca dari sessionStorage (tidak ada di server saat prarender). */
export const usePlatformSession = (refreshKey?: string) => {
  const [state, setState] = useState<{ ready: boolean; admin: PlatformAdmin | null }>({ ready: false, admin: null });
  useEffect(() => setState({ ready: true, admin: read()?.admin ?? null }), [refreshKey]);
  const logout = useCallback(() => {
    platformLogout();
    setState({ ready: true, admin: null });
  }, []);
  return { ...state, logout };
};
