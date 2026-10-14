#!/usr/bin/env node
// npm run doctor
// Memeriksa lingkungan: Node, .env, koneksi dan versi MySQL, migrasi, port, dan API.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { c, fail, loadDotenv, maskUrl, ok, parseDbUrl, root, warn } from "./lib.mjs";

let problems = 0;
const bad = (msg, hint) => {
  problems++;
  fail(msg);
  if (hint) console.log(c.dim(`    ${hint}`));
};

console.log(c.bold("\nNaqdi doctor\n"));

// Node
const [major] = process.versions.node.split(".").map(Number);
major >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} terlalu lama`, "Butuh Node 20+.");

// .env
if (loadDotenv()) ok(".env ditemukan");
else bad(".env tidak ada", "Jalankan: npm run setup");

// dependensi
for (const dir of [".", "apps/web"]) {
  existsSync(path.join(root, dir, "node_modules"))
    ? ok(`dependensi ${dir === "." ? "root" : dir} terpasang`)
    : bad(`dependensi ${dir === "." ? "root" : dir} belum terpasang`, "Jalankan: npm run setup");
}

// variabel
const need = ["DATABASE_URL", "JWT_SECRET"];
for (const key of need) if (!process.env[key]) bad(`${key} kosong`, "Isi di .env (lihat .env.example).");
if (process.env.JWT_SECRET) {
  if (process.env.JWT_SECRET.length < 32) bad("JWT_SECRET kurang dari 32 karakter");
  else if (process.env.JWT_SECRET.includes("ganti-dengan")) {
    process.env.NODE_ENV === "production"
      ? bad("JWT_SECRET masih nilai contoh di produksi")
      : warn("JWT_SECRET masih nilai contoh (boleh untuk pengembangan, wajib diganti di produksi)");
  } else ok("JWT_SECRET terisi");
}
if (process.env.QUEUE_DRIVER === "redis" && !process.env.REDIS_URL) bad("QUEUE_DRIVER=redis tetapi REDIS_URL kosong");
else ok(`antrean: ${process.env.QUEUE_DRIVER ?? "db"} (Redis ${process.env.QUEUE_DRIVER === "redis" ? "dipakai" : "tidak diperlukan"})`);

// MySQL
if (process.env.DATABASE_URL && existsSync(path.join(root, "node_modules", "mysql2"))) {
  const mysql = createRequire(path.join(root, "package.json"))("mysql2/promise");
  const cfg = parseDbUrl(process.env.DATABASE_URL);
  console.log(c.dim(`  menghubungi ${maskUrl(process.env.DATABASE_URL)}`));
  try {
    const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
    const [[v]] = await conn.query("SELECT VERSION() AS v");
    const version = String(v.v);
    const mm = /^(\d+)\.(\d+)/.exec(version);
    const isMaria = /mariadb/i.test(version);
    if (isMaria) warn(`server ${version} adalah MariaDB; yang diuji adalah MySQL 8.4`);
    else if (mm && (Number(mm[1]) > 8 || (Number(mm[1]) === 8 && Number(mm[2]) >= 0))) ok(`MySQL ${version}`);
    else bad(`MySQL ${version} terlalu lama`, "Butuh MySQL 8.0+ (disarankan 8.4).");

    const [dbs] = await conn.query("SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [cfg.database]);
    if (dbs.length === 0) bad(`database "${cfg.database}" belum ada`, "Jalankan: npm run db:migrate");
    else {
      ok(`database "${cfg.database}" ada`);
      const [mig] = await conn.query(
        "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '__drizzle_migrations'",
        [cfg.database],
      );
      mig[0].n > 0 ? ok("migrasi sudah dijalankan") : bad("migrasi belum dijalankan", "Jalankan: npm run db:migrate");
      const [eng] = await conn.query(
        "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND ENGINE <> 'InnoDB'",
        [cfg.database],
      );
      eng.length === 0
        ? ok("semua tabel InnoDB (transaksi dan foreign key aktif)")
        : bad(`${eng.length} tabel bukan InnoDB: ${eng.map((r) => r.t).slice(0, 4).join(", ")}`, "Di pengembangan: npm run db:reset -- --yes lalu npm run db:migrate. Di data penting: ALTER TABLE ... ENGINE=InnoDB (foreign key harus dibuat ulang).");
      const [[def]] = await conn.query("SELECT @@default_storage_engine AS e");
      if (def.e !== "InnoDB") warn(`default_storage_engine server = ${def.e}. Aplikasi memaksa InnoDB per sesi, tetapi sebaiknya ubah di my.ini: default-storage-engine=InnoDB`);
    }
    await conn.end();
  } catch (e) {
    bad(`tidak bisa terhubung ke MySQL: ${e.code ?? e.message}`, "Pastikan layanan MySQL menyala dan DATABASE_URL benar (host, port, user, kata sandi).");
  }
}

// port
const portFree = (port, host) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
const apiPort = Number(process.env.API_PORT ?? 4000);
const apiUp = await fetch(`http://${process.env.API_HOST ?? "127.0.0.1"}:${apiPort}/api/v1/health`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
if (apiUp) ok(`API sedang berjalan di port ${apiPort}`);
else (await portFree(apiPort, process.env.API_HOST ?? "127.0.0.1")) ? ok(`port API ${apiPort} tersedia`) : bad(`port ${apiPort} dipakai proses lain`, "Ubah API_PORT di .env.");
(await portFree(3000, "0.0.0.0")) ? ok("port web 3000 tersedia") : warn("port 3000 sedang dipakai (mungkin web Naqdi yang sudah berjalan)");

console.log(problems ? `\n${c.red(`${problems} masalah ditemukan.`)}\n` : `\n${c.green("Semua pemeriksaan lolos.")}\n`);
process.exit(problems ? 1 : 0);
