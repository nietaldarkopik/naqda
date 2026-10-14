/**
 * Klien API untuk web. Token akses disimpan di memori (bukan localStorage); refresh token
 * hanya ada di cookie httpOnly yang dikelola server. Semua panggilan memakai asal yang sama
 * (/api/v1), yang di-proxy oleh Next ke server API.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type RefreshResult = { ok: boolean; data?: SessionPayload };

let accessToken: string | null = null;
let refreshing: Promise<RefreshResult> | null = null;
let onSessionLost: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const setSessionLostHandler = (fn: (() => void) | null) => {
  onSessionLost = fn;
};

const currentLocale = (): string =>
  typeof document === "undefined" ? "id" : document.documentElement.lang || "id";

const raw = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("x-client", "web");
  headers.set("x-locale", currentLocale());
  if (accessToken && !headers.has("authorization")) headers.set("authorization", `Bearer ${accessToken}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  try {
    return await fetch(`/api/v1${path}`, { ...init, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "network");
  }
};

const toError = async (res: Response) => {
  let data: { code?: string; message?: string; fields?: Record<string, string> } = {};
  try {
    data = await res.json();
  } catch {
    /* tubuh kosong */
  }
  return new ApiError(res.status, data.code ?? "server", data.message ?? res.statusText, data.fields);
};

/** Tukar refresh token (cookie) dengan token akses baru. Beberapa pemanggil menunggu satu permintaan. */
export const refreshSession = (): Promise<RefreshResult> => {
  if (!refreshing) {
    refreshing = (async (): Promise<RefreshResult> => {
      const res = await raw("/auth/refresh", { method: "POST", json: {} });
      if (!res.ok) {
        accessToken = null;
        return { ok: false };
      }
      const data = (await res.json()) as SessionPayload;
      accessToken = data.accessToken;
      return { ok: true, data };
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
};

/** Permintaan terautentikasi dengan satu kali percobaan ulang setelah token diperbarui. */
const authed = async (path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> => {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed.ok) res = await raw(path, init);
    else {
      onSessionLost?.();
      throw await toError(res);
    }
  }
  return res;
};

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await authed(path, init);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Seperti api(), tetapi tidak melempar untuk 4xx: mengembalikan status dan isi (mis. laporan impor 422). */
export async function apiResult<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await authed(path, init);
  if (res.status === 401 || res.status >= 500) throw await toError(res);
  return { status: res.status, body: (await res.json()) as T };
}

/** Mengunggah satu berkas (multipart). Server memeriksa isi berkas, bukan hanya namanya. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  const res = await authed(path, { method: "POST", body });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/** Mengunduh berkas yang dilindungi token (mis. ekspor CSV) lewat tautan sementara. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await authed(path);
  if (!res.ok) throw await toError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  locale: string | null;
  role: { id: string; systemKey: string | null; name: string | null; accessType: string };
  privileges: string[];
  outlets: Array<{ id: string; name: string }>;
}

export interface SessionBusiness {
  id: string;
  name: string;
  currency: string;
  currencyExponent: number;
  defaultLocale: string;
}

export interface SessionPayload {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
  business: SessionBusiness | null;
}

export const loginRequest = async (email: string, password: string): Promise<SessionPayload> => {
  const res = await raw("/auth/login", { method: "POST", json: { email, password } });
  if (!res.ok) throw await toError(res);
  const data = (await res.json()) as SessionPayload;
  accessToken = data.accessToken;
  return data;
};

export const logoutRequest = async () => {
  await raw("/auth/logout", { method: "POST", json: {} }).catch(() => undefined);
  accessToken = null;
};

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
