import { randomBytes } from "node:crypto";
import { createDb } from "../client";
import { defaultDatabaseUrl, loadEnv } from "../env";
import { platformAdmins } from "../schema";
import { hashPassword } from "../seed";
import { newId } from "../uuid";

loadEnv();

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const usage = `Membuat akun PENGELOLA platform (operator Naqdi), terpisah dari pengguna toko.

  npm run platform:create-admin -- --email ani@perusahaan.com --name "Ani" [--role owner|support] [--password ...]

  --role      owner = boleh mengubah bisnis; support = hanya melihat (bawaan: support)
  --password  minimal 12 karakter; kosong = dibuat acak dan ditampilkan SEKALI (atau env PLATFORM_ADMIN_PASSWORD)

Panel pengelola: /{bahasa}/platform`;

const email = flag("email")?.trim().toLowerCase();
const name = flag("name")?.trim();
const role = (flag("role") ?? "support") as "owner" | "support";
if (!email || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["owner", "support"].includes(role)) {
  console.error(usage);
  process.exit(1);
}
const given = flag("password") ?? process.env.PLATFORM_ADMIN_PASSWORD;
if (given !== undefined && given.length < 12) {
  console.error("Kata sandi pengelola minimal 12 karakter.");
  process.exit(1);
}
const password = given ?? randomBytes(15).toString("base64url");

const handle = createDb(process.env.DATABASE_URL ?? defaultDatabaseUrl, { connectionLimit: 2 });
try {
  await handle.db.insert(platformAdmins).values({ id: newId(), email, name, role, passwordHash: await hashPassword(password, 12) });
  console.log(`Pengelola dibuat: ${email} (${role}).`);
  console.log(given ? "Kata sandi: sesuai yang Anda berikan." : `Kata sandi (ditampilkan SEKALI, simpan sekarang): ${password}`);
} catch (e) {
  const msg = e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : String(e);
  console.error(/Duplicate entry|ER_DUP_ENTRY/.test(msg) ? "Email itu sudah terdaftar sebagai pengelola." : msg);
  process.exitCode = 1;
} finally {
  await handle.close();
}
