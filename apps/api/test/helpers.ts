import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { assertInnoDb, createDb, createBusinessWithRoles, hashPassword, newId, outlets, userOutlets, users } from "@naqdi/db";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { LoginLimiter } from "../src/auth/limiter";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "mysql://root:@127.0.0.1:3306/naqdi_test";
export const PASSWORD = "Rahasia123!";

export const testConfig = () =>
  parseConfig({
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl,
    JWT_SECRET: "rahasia-uji-yang-panjang-minimal-32-karakter-aman",
    BCRYPT_COST: "4",
    CORS_ORIGINS: "http://localhost:3000",
    STORAGE_DIR: path.join(os.tmpdir(), "naqdi-test-storage"),
  });

export interface Fixture {
  handle: ReturnType<typeof createDb>;
  app: ReturnType<typeof createApp>;
  limiter: LoginLimiter;
  a: Tenant;
  b: Tenant;
}

export interface Tenant {
  businessId: string;
  roleIds: Record<string, string>;
  salesTypeIds: Record<string, string>;
  outletIds: string[];
  adminEmail: string;
  cashierEmail: string;
  investorEmail: string;
  managerEmail: string;
  /** Akhiran email unik tenant ini, mis. "-Aab12cd@uji.test". */
  emailSuffix: string;
}

const makeTenant = async (handle: Fixture["handle"], label: string): Promise<Tenant> => {
  const { db } = handle;
  const { businessId, roleIds, salesTypeIds } = await createBusinessWithRoles(db, { name: `Bisnis ${label}` });
  const outletIds = [newId(), newId()];
  await db.insert(outlets).values(
    outletIds.map((id, i) => ({ id, businessId, name: `Outlet ${label}${i + 1}`, phone: "0800" })),
  );
  const passwordHash = await hashPassword(PASSWORD, 4);
  const make = async (key: string, systemRole: string, email: string, outlet: string[]) => {
    const id = newId();
    await db.insert(users).values({ id, businessId, name: `${key} ${label}`, email, roleId: roleIds[systemRole]!, passwordHash });
    await db.insert(userOutlets).values(outlet.map((outletId) => ({ userId: id, outletId })));
  };
  const t: Tenant = {
    businessId,
    roleIds,
    salesTypeIds,
    outletIds,
    adminEmail: `admin-${label}@uji.test`,
    cashierEmail: `kasir-${label}@uji.test`,
    investorEmail: `investor-${label}@uji.test`,
    managerEmail: `manajer-${label}@uji.test`,
    emailSuffix: `-${label}@uji.test`,
  };
  await make("Admin", "administrator", t.adminEmail, outletIds);
  await make("Kasir", "cashier", t.cashierEmail, [outletIds[0]!]);
  await make("Investor", "investor", t.investorEmail, outletIds);
  await make("Manajer", "regionalManager", t.managerEmail, outletIds);
  return t;
};

/**
 * Dua bisnis uji baru dengan label acak di database tes. Skema dibuat sekali per proses tes
 * (global-setup.ts), jadi berkas tes tidak menghapus database dan tidak saling mengganggu.
 */
export const setupFixture = async (): Promise<Fixture> => {
  const handle = createDb(testDatabaseUrl, { connectionLimit: 4 });
  await assertInnoDb(handle);
  const limiter = new LoginLimiter();
  const app = createApp({ handle, config: testConfig(), limiter });
  const run = randomBytes(3).toString("hex");
  return { handle, app, limiter, a: await makeTenant(handle, `A${run}`), b: await makeTenant(handle, `B${run}`) };
};

type App = Fixture["app"];

export const call = async (
  app: App,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) => {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
};

export const login = async (app: App, email: string, password = PASSWORD) => {
  const res = await call(app, "POST", "/auth/login", { body: { email, password } });
  return { ...res, token: res.json?.accessToken as string | undefined, refresh: res.json?.refreshToken as string | undefined };
};
