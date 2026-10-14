import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type DbHandle = ReturnType<typeof createDb>;
export type Db = DbHandle["db"];

/**
 * Membuat pool MySQL. Semua sesi diset ke UTC agar DATETIME(3) konsisten (doc 02, bagian 3.0).
 * `url` berformat mysql://USER:PASSWORD@HOST:PORT/DATABASE
 */
export const createDb = (url: string, options: { connectionLimit?: number } = {}) => {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: options.connectionLimit ?? 10,
    timezone: "Z",
    charset: "utf8mb4",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  pool.on("connection", (conn) => {
    // InnoDB dipaksa per sesi: sebagian server (mis. paket WAMP/XAMPP) bawaannya MyISAM, yang tidak
    // mendukung transaksi maupun foreign key. Lihat doc 02, bagian 3.0.
    conn.query("SET time_zone = '+00:00', default_storage_engine = 'InnoDB'");
  });
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool, close: () => pool.end() };
};

/** Memecah DATABASE_URL menjadi bagian-bagiannya (untuk membuat database bila belum ada). */
export const parseDatabaseUrl = (url: string) => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
};

/** Tabel di database aktif yang BUKAN InnoDB. Harus kosong: transaksi dan foreign key bergantung padanya. */
export const nonInnoDbTables = async (handle: { pool: { query: (sql: string) => Promise<unknown> } }): Promise<string[]> => {
  const [rows] = (await handle.pool.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND ENGINE <> 'InnoDB'",
  )) as [Array<{ name: string }>, unknown];
  return rows.map((r) => r.name);
};

export class StorageEngineError extends Error {
  constructor(public readonly tables: string[]) {
    super(
      `Tabel berikut bukan InnoDB: ${tables.join(", ")}. Transaksi dan foreign key tidak berfungsi pada mesin lain. ` +
        "Buat ulang database (npm run db:reset di pengembangan) atau konversi dengan ALTER TABLE ... ENGINE=InnoDB.",
    );
  }
}

export const assertInnoDb = async (handle: Parameters<typeof nonInnoDbTables>[0]): Promise<void> => {
  const bad = await nonInnoDbTables(handle);
  if (bad.length) throw new StorageEngineError(bad);
};

const safeName = /^[A-Za-z0-9_]+$/;

/**
 * Membuat database bila belum ada, dengan kolasi yang direncanakan (utf8mb4_0900_ai_ci).
 * Hanya menyentuh database bernama `database`; tidak pernah menghapus apa pun kecuali `recreate: true`.
 */
export const ensureDatabase = async (url: string, opts: { recreate?: boolean } = {}): Promise<void> => {
  const { host, port, user, password, database } = parseDatabaseUrl(url);
  if (!safeName.test(database)) throw new Error(`Nama database tidak valid: ${database}`);
  const conn = await mysql.createConnection({ host, port, user, password });
  try {
    if (opts.recreate) await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await conn.end();
  }
};
