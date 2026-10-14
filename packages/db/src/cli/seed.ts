import { createDb } from "../client";
import { defaultDatabaseUrl, loadEnv } from "../env";
import { demoDefaults, seedDemo } from "../seed";

loadEnv();

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Seed data demo ditolak di produksi. Gunakan --force bila memang disengaja.");
  process.exit(1);
}

const handle = createDb(process.env.DATABASE_URL ?? defaultDatabaseUrl, { connectionLimit: 2 });
try {
  const result = await seedDemo(handle.db, { adminPassword: process.env.DEMO_PASSWORD });
  if (result.created) {
    console.log("Data demo dibuat.");
    console.log(`  Admin : ${result.email}`);
    console.log(`  Kasir : ${demoDefaults.cashierEmail} (peran app-only, tidak bisa masuk Back Office)`);
    console.log(`  Kata sandi: ${result.password}`);
  } else {
    console.log("Data demo sudah ada, tidak ada yang diubah.");
  }
} finally {
  await handle.close();
}
