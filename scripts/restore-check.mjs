// Uji pemulihan: memulihkan cadangan ke database SEMENTARA (bukan database kerja), membandingkannya dengan sumber,
// lalu menghapus database sementara itu. Cadangan yang belum pernah dipulihkan belum bisa dipercaya.
// Pakai: node scripts/restore-check.mjs [berkas.sql.gz] [--out DIR] [--strict]
//   tanpa berkas  : memakai cadangan terbaru di folder cadangan
//   --strict      : jumlah baris setiap tabel harus SAMA dengan database sumber (gunakan tepat setelah backup, tanpa penulisan baru)
// Database sumber TIDAK diubah. Keluar != 0 bila ada yang tidak beres.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import mysql from "mysql2/promise";
import { c, fail, findMysqlTool, loadDotenv, ok, parseDbUrl, root, warn } from "./lib.mjs";

loadDotenv();
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = path.resolve(root, flagValue("out") ?? process.env.BACKUP_DIR ?? "backups");
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL kosong (isi .env).");
  process.exit(1);
}
const src = parseDbUrl(process.env.DATABASE_URL);
let file = positional[0] ? path.resolve(positional[0]) : null;
if (!file) {
  const latest = existsSync(outDir) ? readdirSync(outDir).filter((f) => /^naqdi-\d{8}-\d{6}\.sql\.gz$/.test(f)).sort().at(-1) : null;
  if (!latest) {
    fail(`tidak ada cadangan di ${outDir}. Jalankan npm run backup dulu.`);
    process.exit(1);
  }
  file = path.join(outDir, latest);
}
if (!existsSync(file)) {
  fail(`berkas tidak ada: ${file}`);
  process.exit(1);
}
const mysqlBin = findMysqlTool("mysql");
if (!mysqlBin) {
  fail("klien mysql tidak ditemukan. Pasang klien MySQL atau isi MYSQL_PATH.");
  process.exit(1);
}
console.log(c.bold("Uji pemulihan"), c.dim(path.basename(file)));

let failures = 0;
const check = (label, good, extra = "") => {
  (good ? ok : fail)(`${label}${extra ? "  " + c.dim(extra) : ""}`);
  if (!good) failures++;
};

// 1. Checksum
const shaFile = `${file}.sha256`;
if (existsSync(shaFile)) {
  const want = readFileSync(shaFile, "utf8").split(/\s+/)[0];
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  check("checksum cadangan cocok", h.digest("hex") === want);
} else warn("tidak ada berkas .sha256; checksum tidak diperiksa.");

// 2. Pulihkan ke database sementara
const temp = `${src.database}_restorecheck`;
if (temp === src.database) {
  fail("nama database sementara bentrok dengan sumber.");
  process.exit(1);
}
const admin = await mysql.createConnection({ host: src.host, port: src.port, user: src.user, password: src.password, multipleStatements: false });
const ident = (n) => `\`${n.replace(/`/g, "``")}\``;
let source;
let restored;
try {
  await admin.query(`DROP DATABASE IF EXISTS ${ident(temp)}`);
  await admin.query(`CREATE DATABASE ${ident(temp)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  const client = spawn(mysqlBin, ["-h", src.host, "-P", String(src.port), "-u", src.user, "--default-character-set=utf8mb4", temp], {
    env: { ...process.env, MYSQL_PWD: src.password },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let err = "";
  client.stderr.on("data", (d) => (err += d));
  const done = new Promise((resolve) => client.on("close", resolve));
  let pipeError = null;
  await pipeline(createReadStream(file), createGunzip(), client.stdin).catch((e) => {
    pipeError = e;
  });
  const code = await done;
  const restoreOk = code === 0 && !pipeError;
  check("cadangan dapat dipulihkan tanpa galat", restoreOk, restoreOk ? "" : (pipeError?.message ?? err.trim().split(/\r?\n/).pop()));
  if (!restoreOk) throw new Error("pemulihan gagal; perbandingan dilewati");

  // 3. Bandingkan dengan sumber
  source = await mysql.createConnection({ host: src.host, port: src.port, user: src.user, password: src.password, database: src.database });
  restored = await mysql.createConnection({ host: src.host, port: src.port, user: src.user, password: src.password, database: temp });
  const tables = async (conn, dbName) => (await conn.query("SELECT table_name AS t, engine AS e FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name", [dbName]))[0].map((r) => ({ t: r.t ?? r.T, e: r.e ?? r.E }));
  const [a, b] = [await tables(source, src.database), await tables(restored, temp)];
  check(`jumlah tabel sama (${a.length})`, a.length === b.length && a.every((x, i) => x.t === b[i]?.t));
  check("semua tabel hasil pemulihan berengine InnoDB", b.every((x) => x.e === "InnoDB"));

  const diffs = [];
  let totalRows = 0;
  for (const { t } of b) {
    const [[rs]] = await restored.query(`SELECT COUNT(*) AS n FROM ${ident(t)}`);
    const [[ss]] = await source.query(`SELECT COUNT(*) AS n FROM ${ident(t)}`).catch(() => [[{ n: -1 }]]);
    totalRows += Number(rs.n);
    if (Number(rs.n) !== Number(ss.n)) diffs.push(`${t}: cadangan ${rs.n}, sumber ${ss.n}`);
  }
  if (strict) check("jumlah baris setiap tabel sama dengan sumber", diffs.length === 0, diffs.slice(0, 3).join("; "));
  else if (diffs.length) warn(`sumber berubah sejak cadangan dibuat (wajar): ${diffs.slice(0, 3).join("; ")}${diffs.length > 3 ? ` (+${diffs.length - 3})` : ""}`);
  else ok("jumlah baris sama dengan sumber");

  // 4. Integritas: tidak ada baris yatim pada relasi utama
  const orphans = [
    ["order_items tanpa order", "SELECT COUNT(*) n FROM order_items i LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL"],
    ["payments tanpa order", "SELECT COUNT(*) n FROM payments p LEFT JOIN orders o ON o.id = p.order_id WHERE o.id IS NULL"],
    ["nomor struk ganda", "SELECT COUNT(*) n FROM (SELECT outlet_id, receipt_number FROM orders WHERE receipt_number IS NOT NULL GROUP BY outlet_id, receipt_number HAVING COUNT(*) > 1) d"],
  ];
  for (const [label, sql] of orphans) {
    const [[r]] = await restored.query(sql);
    check(`integritas: ${label} = 0`, Number(r.n) === 0, Number(r.n) ? `ditemukan ${r.n}` : "");
  }
  const [[mig]] = await restored.query("SELECT COUNT(*) n FROM __drizzle_migrations").catch(() => [[{ n: -1 }]]);
  check("riwayat migrasi ikut terpulihkan", Number(mig.n) > 0, `${mig.n} migrasi, ${totalRows} baris`);
} catch (e) {
  fail(`uji pemulihan berhenti: ${e.message}`);
  failures++;
} finally {
  await source?.end().catch(() => undefined);
  await restored?.end().catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS ${ident(temp)}`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}
console.log(failures === 0 ? c.green("\nPemulihan terbukti berhasil.") : c.red(`\n${failures} pemeriksaan gagal.`));
process.exit(failures === 0 ? 0 : 1);
