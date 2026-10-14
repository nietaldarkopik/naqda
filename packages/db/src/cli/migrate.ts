import { assertInnoDb, createDb, ensureDatabase } from "../client";
import { defaultDatabaseUrl, loadEnv } from "../env";
import { runMigrations } from "../migrate";

loadEnv();
const url = process.env.DATABASE_URL ?? defaultDatabaseUrl;
const label = url.replace(/:\/\/([^:@/]*):[^@]*@/, "://$1:***@");

try {
  await ensureDatabase(url);
  await runMigrations(url);
  const handle = createDb(url, { connectionLimit: 1 });
  await assertInnoDb(handle).catch(async (e) => {
    await handle.close();
    throw e;
  });
  const [rows] = await handle.pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()");
  await handle.close();
  console.log(`Migrasi selesai: ${label} (${(rows as Array<{ n: number }>)[0]?.n ?? "?"} tabel)`);
} catch (error) {
  console.error(`Migrasi gagal untuk ${label}:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
