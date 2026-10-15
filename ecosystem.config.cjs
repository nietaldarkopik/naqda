// Konfigurasi pm2 untuk menjalankan Naqdi sebagai layanan: `pm2 start ecosystem.config.cjs && pm2 save`.
// Web memakai port WEB_PORT (bawaan 3100, bukan 3000 yang sering dipakai aplikasi lain di mesin yang sama);
// API hanya mendengarkan di 127.0.0.1:4000 dan dijangkau lewat web (/api/v1 di-proxy oleh Next).
// Prasyarat: npm ci, npm run db:migrate, npm run build, dan .env berisi DATABASE_URL + JWT_SECRET acak.
const path = require("node:path");

const root = __dirname;
const webPort = process.env.WEB_PORT || "3100";

module.exports = {
  apps: [
    {
      name: "naqdi-api",
      cwd: root,
      script: path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "apps/api/src/server.ts",
      // TRUST_PROXY_HOPS: jumlah proxy tepercaya di depan API (Apache + Next = 2); dipakai untuk alamat IP klien pada pembatas laju.
      // BILLING_BANK_INFO: petunjuk transfer di faktur (rekening resmi Naqdi; \n = baris baru). Kosong = pelanggan diminta menghubungi pengelola.
      // SIGNUP_ENABLED: pendaftaran mandiri mati di produksi sampai dinyalakan (jangan sebelum ada verifikasi email dan dokumen hukum).
      env: { NODE_ENV: "production", TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS || "2", SIGNUP_ENABLED: process.env.SIGNUP_ENABLED || "false", BILLING_BANK_INFO: process.env.BILLING_BANK_INFO || "" },
      max_restarts: 10,
      min_uptime: "10s",
    },
    {
      name: "naqdi-web",
      cwd: path.join(root, "apps", "web"),
      script: path.join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next"),
      args: `start -p ${webPort}`,
      env: { NODE_ENV: "production" },
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
