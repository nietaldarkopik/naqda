// Fungsi bantu bersama untuk skrip setup, doctor, dan dev. Hanya memakai Node (tanpa bash),
// agar berjalan sama di Windows, macOS, dan Linux.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const isWin = process.platform === "win32";

const useColor = process.stdout.isTTY;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { green: paint(32), red: paint(31), yellow: paint(33), dim: paint(2), bold: paint(1), cyan: paint(36) };

export const ok = (msg) => console.log(`${c.green("✓")} ${msg}`);
export const warn = (msg) => console.log(`${c.yellow("!")} ${msg}`);
export const fail = (msg) => console.log(`${c.red("✗")} ${msg}`);

/** Membaca berkas .env sederhana (KEY=VALUE) tanpa menimpa variabel lingkungan yang sudah ada. */
export const loadDotenv = (file = path.join(root, ".env")) => {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, raw] = m;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
};

/** Menjalankan perintah dan menunggu selesai. Mengembalikan kode keluar. */
export const run = (cmd, args, options = {}) =>
  new Promise((resolve) => {
    // Di Windows npm berupa .cmd sehingga perlu shell; kirim sebagai satu string (argumen di sini statis dan tepercaya).
    const child = isWin
      ? spawn([cmd, ...args].join(" "), { cwd: root, stdio: "inherit", shell: true, ...options })
      : spawn(cmd, args, { cwd: root, stdio: "inherit", ...options });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

export const capture = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: isWin });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

export const parseDbUrl = (url) => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
};

export const maskUrl = (url) => url.replace(/:\/\/([^:@/]*):[^@]*@/, "://$1:***@");
