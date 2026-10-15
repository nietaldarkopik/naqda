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
      env: { NODE_ENV: "production" },
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
