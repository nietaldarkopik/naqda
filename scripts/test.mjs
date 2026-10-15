// Menjalankan seluruh tes (atau yang ditentukan: npm test -- packages/sync) dengan folder kerja KANONIK.
//
// Di Windows huruf drive bisa datang sebagai "c:" atau "C:" tergantung cara terminal dibuka. Bila CLI vitest dimulai dari jalur
// berhuruf kecil sedangkan berkas tes dimuat lewat jalur berhuruf besar, `vitest` termuat dua kali dan SEMUA tes gagal dengan
// "Cannot read properties of undefined (reading 'config')" tanpa ada yang salah di kode. Pembungkus ini menormalkan folder kerja dulu.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const cwd = realpathSync.native(process.cwd());
const cli = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [cli, "run", ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(run.status ?? 1);
