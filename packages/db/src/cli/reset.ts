import { ensureDatabase, parseDatabaseUrl } from "../client";
import { defaultDatabaseUrl, loadEnv } from "../env";

// npm run db:reset : MENGHAPUS database kerja lalu membuatnya ulang (migrasi + seed dijalankan terpisah).
// Hanya untuk pengembangan; ditolak di produksi dan untuk database yang namanya tidak jelas.
loadEnv();
const url = process.env.DATABASE_URL ?? defaultDatabaseUrl;
if (process.env.NODE_ENV === "production") {
  console.error("db:reset ditolak di produksi.");
  process.exit(1);
}
const { database } = parseDatabaseUrl(url);
if (!process.argv.includes("--yes")) {
  console.error(`Ini akan MENGHAPUS seluruh isi database "${database}". Jalankan ulang dengan --yes untuk melanjutkan.`);
  process.exit(1);
}
await ensureDatabase(url, { recreate: true });
console.log(`Database "${database}" dibuat ulang (kosong). Lanjutkan: npm run db:migrate && npm run db:seed`);
