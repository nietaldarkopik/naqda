#!/usr/bin/env node
// npm run setup  [--no-seed] [--skip-install]
// Menyiapkan lingkungan dari repo bersih: .env, dependensi, database, migrasi, data demo.
// Perintah yang sama dipakai dengan maupun tanpa Docker.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { c, fail, loadDotenv, ok, parseDbUrl, root, run, warn } from "./lib.mjs";

const args = new Set(process.argv.slice(2));
const placeholder = "ganti-dengan-rahasia-acak-minimal-32-karakter";

console.log(c.bold("\nNaqdi: menyiapkan lingkungan\n"));

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  fail(`Node ${process.versions.node} terlalu lama. Butuh Node 20 atau lebih baru.`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

// 1. .env
const envFile = path.join(root, ".env");
if (!existsSync(envFile)) {
  copyFileSync(path.join(root, ".env.example"), envFile);
  const secret = randomBytes(36).toString("base64url");
  writeFileSync(envFile, readFileSync(envFile, "utf8").replace(placeholder, secret));
  ok(".env dibuat dari .env.example dengan JWT_SECRET acak");
} else {
  ok(".env sudah ada (tidak diubah)");
}
loadDotenv();

// 2. dependensi
if (!args.has("--skip-install")) {
  for (const dir of [".", "apps/web"]) {
    if (existsSync(path.join(root, dir, "node_modules"))) {
      ok(`dependensi ${dir === "." ? "root" : dir} sudah terpasang`);
      continue;
    }
    console.log(c.dim(`  npm install di ${dir} ...`));
    const code = await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(root, dir) });
    if (code !== 0) {
      fail(`npm install gagal di ${dir}`);
      process.exit(1);
    }
    ok(`dependensi ${dir === "." ? "root" : dir} terpasang`);
  }
}

// 3. database + migrasi
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  fail("DATABASE_URL belum diisi di .env");
  process.exit(1);
}
const db = parseDbUrl(dbUrl);
console.log(c.dim(`  database: ${db.user}@${db.host}:${db.port}/${db.database}`));
if ((await run("npm", ["run", "db:migrate", "--silent"])) !== 0) {
  fail("Migrasi gagal. Pastikan MySQL 8.4 berjalan dan DATABASE_URL benar.");
  console.log(
    c.dim("  Tanpa Docker: nyalakan layanan MySQL Anda. Dengan Docker: `docker compose up -d` lalu ulangi `npm run setup`."),
  );
  process.exit(1);
}

// 4. data demo
if (args.has("--no-seed") || process.env.NODE_ENV === "production") {
  warn("data demo dilewati");
} else if ((await run("npm", ["run", "db:seed", "--silent"])) !== 0) {
  fail("Seed gagal");
  process.exit(1);
}

console.log(`\n${c.green("Selesai.")} Jalankan ${c.bold("npm run dev")} lalu buka http://localhost:3000`);
console.log(c.dim("Periksa kesehatan lingkungan kapan saja dengan: npm run doctor\n"));
