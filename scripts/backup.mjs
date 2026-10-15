// Cadangan database Naqdi: mysqldump konsisten (--single-transaction) -> .sql.gz + checksum, lalu pangkas yang lama.
// Pakai: node scripts/backup.mjs [--out DIR] [--keep N] [--storage]
//   --out      folder tujuan (bawaan: BACKUP_DIR atau ./backups; letakkan di disk/mesin LAIN dari database untuk produksi)
//   --keep     jumlah cadangan terbaru yang dipertahankan (bawaan 14)
//   --storage  sertakan folder gambar unggahan (STORAGE_DIR) sebagai .tar.gz
// Keluar dengan kode != 0 bila gagal, sehingga bisa dipantau oleh Task Scheduler/cron.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { c, fail, findMysqlTool, loadDotenv, maskUrl, ok, parseDbUrl, root, warn } from "./lib.mjs";

loadDotenv();
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const outDir = path.resolve(root, opt("out", process.env.BACKUP_DIR ?? "backups"));
const keep = Number(opt("keep", "14"));
const withStorage = args.includes("--storage");

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL kosong (isi .env).");
  process.exit(1);
}
if (!Number.isInteger(keep) || keep < 1) {
  fail("--keep harus bilangan bulat >= 1.");
  process.exit(1);
}
const db = parseDbUrl(process.env.DATABASE_URL);
const dump = findMysqlTool("mysqldump");
if (!dump) {
  fail("mysqldump tidak ditemukan. Pasang klien MySQL atau isi MYSQLDUMP_PATH.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const base = `naqdi-${stamp}`;
const target = path.join(outDir, `${base}.sql.gz`);
const partial = `${target}.partial`;

console.log(c.bold("Cadangan Naqdi"), c.dim(maskUrl(process.env.DATABASE_URL)));

// Kata sandi lewat lingkungan proses (bukan argumen) agar tidak tampil di daftar proses.
const child = spawn(
  dump,
  ["-h", db.host, "-P", String(db.port), "-u", db.user, "--single-transaction", "--routines", "--triggers", "--no-tablespaces", "--default-character-set=utf8mb4", "--set-gtid-purged=OFF", db.database],
  { env: { ...process.env, MYSQL_PWD: db.password }, stdio: ["ignore", "pipe", "pipe"] },
);
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
const exited = new Promise((resolve) => child.on("close", resolve));
try {
  await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(partial));
} catch (e) {
  rmSync(partial, { force: true });
  fail(`menulis cadangan gagal: ${e.message}`);
  process.exit(1);
}
const code = await exited;
if (code !== 0) {
  rmSync(partial, { force: true });
  fail(`mysqldump gagal (kode ${code}): ${stderr.trim().split(/\r?\n/).pop()}`);
  process.exit(1);
}

// mysqldump yang berhasil selalu menutup berkas dengan baris "Dump completed"; tanpa itu cadangan terpotong.
const verifyComplete = async (file) => {
  let tail = "";
  for await (const chunk of createReadStream(file).pipe(createGunzip())) tail = (tail + chunk.toString("utf8")).slice(-400);
  return /Dump completed/.test(tail);
};
if (!(await verifyComplete(partial))) {
  rmSync(partial, { force: true });
  fail("cadangan tidak lengkap (tidak ada penanda 'Dump completed').");
  process.exit(1);
}
renameSync(partial, target);

const sha = createHash("sha256");
await pipeline(createReadStream(target), sha);
writeFileSync(`${target}.sha256`, `${sha.digest("hex")}  ${path.basename(target)}\n`);
ok(`database -> ${target} (${(statSync(target).size / 1024).toFixed(0)} KB)`);

if (withStorage) {
  const storageDir = path.resolve(root, process.env.STORAGE_DIR ?? "storage");
  if (existsSync(storageDir)) {
    const tarFile = path.join(outDir, `${base}-storage.tar.gz`);
    const code = await new Promise((resolve) => spawn("tar", ["-czf", tarFile, "-C", path.dirname(storageDir), path.basename(storageDir)], { stdio: "inherit" }).on("close", resolve));
    if (code === 0) ok(`unggahan -> ${tarFile}`);
    else {
      fail("mengarsipkan folder unggahan gagal (perintah tar).");
      process.exit(1);
    }
  } else warn(`folder unggahan ${storageDir} tidak ada; dilewati.`);
}

// Pangkas: simpan `keep` cadangan database terbaru beserta pasangannya (checksum dan arsip unggahan).
const sets = readdirSync(outDir)
  .filter((f) => /^naqdi-\d{8}-\d{6}\.sql\.gz$/.test(f))
  .sort()
  .reverse();
for (const f of sets.slice(keep)) {
  const stem = f.replace(/\.sql\.gz$/, "");
  for (const extra of [f, `${f}.sha256`, `${stem}-storage.tar.gz`]) rmSync(path.join(outDir, extra), { force: true });
  console.log(c.dim(`  dihapus (melebihi --keep ${keep}): ${f}`));
}
ok(`selesai. Jalankan "npm run backup:verify" secara berkala: cadangan yang belum pernah dipulihkan belum bisa dipercaya.`);
