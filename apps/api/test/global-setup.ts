import { assertInnoDb, createDb, ensureDatabase, runMigrations } from "@naqdi/db";
import { testDatabaseUrl } from "./helpers";

/**
 * Dijalankan sekali sebelum semua tes: membuat ulang database `*_test` dan menjalankan migrasi.
 * Pengaman: hanya database berakhiran _test yang boleh dihapus.
 */
export default async function setup() {
  if (!/_test$/.test(new URL(testDatabaseUrl).pathname.slice(1))) {
    throw new Error("TEST_DATABASE_URL harus menunjuk ke database berakhiran _test (tes menghapus isinya).");
  }
  await ensureDatabase(testDatabaseUrl, { recreate: true });
  await runMigrations(testDatabaseUrl);
  const handle = createDb(testDatabaseUrl, { connectionLimit: 1 });
  try {
    await assertInnoDb(handle);
  } finally {
    await handle.close();
  }
}
