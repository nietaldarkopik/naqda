import { supportedCurrencies } from "@naqdi/domain";
import { createBusiness } from "../business";
import { createDb } from "../client";
import { defaultDatabaseUrl, loadEnv } from "../env";

loadEnv();

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const usage = `Membuat bisnis baru (tanpa data demo) dengan mata uang pilihan.

  npm run db:create-business -- --name "Toko Riyadh" --currency SAR --admin-email owner@toko.com [opsi]

Wajib   --name         nama bisnis
        --currency     ${supportedCurrencies.map((c) => c.code).join(" ")}
        --admin-email  email administrator pertama
Opsi    --outlet       nama outlet pertama (bawaan: nama bisnis)
        --timezone     zona waktu IANA outlet (bawaan Asia/Jakarta; mis. Asia/Riyadh, America/New_York)
        --locale       bahasa bawaan: id | en | ar (bawaan id)
        --admin-name   nama administrator (bawaan Administrator)
        --admin-password  kata sandi (bawaan: acak, ditampilkan sekali; atau lewat env ADMIN_PASSWORD)

Mata uang tidak bisa diubah setelah ada data bernilai uang, jadi pilih dengan benar sebelum membuat item.`;

const name = flag("name");
const currency = flag("currency");
const adminEmail = flag("admin-email");
if (!name || !currency || !adminEmail) {
  console.error(usage);
  process.exit(1);
}
const locale = flag("locale") ?? "id";
if (!["id", "en", "ar"].includes(locale)) {
  console.error("--locale harus id, en, atau ar");
  process.exit(1);
}

const handle = createDb(process.env.DATABASE_URL ?? defaultDatabaseUrl, { connectionLimit: 2 });
try {
  const adminPassword = flag("admin-password") ?? process.env.ADMIN_PASSWORD;
  const r = await createBusiness(handle.db, {
    name,
    currency,
    defaultLocale: locale as "id" | "en" | "ar",
    ...(flag("outlet") ? { outletName: flag("outlet")! } : {}),
    ...(flag("timezone") ? { timezone: flag("timezone")! } : {}),
    adminEmail,
    ...(flag("admin-name") ? { adminName: flag("admin-name")! } : {}),
    ...(adminPassword ? { adminPassword } : {}),
  });
  console.log(`Bisnis "${name}" dibuat (${currency.toUpperCase()}).`);
  console.log(`  Admin : ${r.email}`);
  console.log(r.generatedPassword ? `  Kata sandi (ditampilkan SEKALI, simpan sekarang): ${r.password}` : "  Kata sandi: sesuai yang Anda berikan");
  console.log("Masuk di /login, lalu buat item, pajak, dan karyawan. Daftarkan perangkat kasir di Perangkat Kasir.");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(/Duplicate entry|ER_DUP_ENTRY/.test(msg) ? "Email itu sudah dipakai pengguna lain." : msg);
  process.exitCode = 1;
} finally {
  await handle.close();
}
