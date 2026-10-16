import { serve } from "@hono/node-server";
import { assertInnoDb, createDb } from "@naqdi/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { logLine } from "./logging";
import { processMailQueue, purgeOldMail } from "./mail/queue";
import { createTransport } from "./mail/transport";

const config = loadConfig();
const handle = createDb(config.databaseUrl);
// Gagal cepat bila ada tabel non-InnoDB: tanpa transaksi, data bisnis bisa rusak setengah jalan.
await assertInnoDb(handle).catch((error: unknown) => {
  console.error(`[api] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
const transport = createTransport(config);
const app = createApp({ handle, config, transport });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Naqdi API berjalan di http://${info.address}:${info.port}/api/v1 (${config.nodeEnv})`);
});

// Pekerja email: mengirim antrean tiap 15 detik. Satu putaran selesai dulu sebelum putaran berikutnya (tidak menumpuk).
let mailBusy = false;
const mailTimer = setInterval(() => {
  if (mailBusy) return;
  mailBusy = true;
  processMailQueue(handle.db, transport)
    .catch((error: unknown) => logLine("error", "mail.worker_failed", { error: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      mailBusy = false;
    });
}, 15_000);
// Email lama dibersihkan tiap jam (retensi 90 hari).
const purgeTimer = setInterval(() => {
  purgeOldMail(handle.db).catch((error: unknown) => logLine("error", "mail.purge_failed", { error: error instanceof Error ? error.message : String(error) }));
}, 3_600_000);
logLine("info", "mail.driver", { driver: transport.driver, from: config.mail.from });

const shutdown = async () => {
  clearInterval(mailTimer);
  clearInterval(purgeTimer);
  server.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
