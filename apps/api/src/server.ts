import { serve } from "@hono/node-server";
import { assertInnoDb, createDb } from "@naqdi/db";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const handle = createDb(config.databaseUrl);
// Gagal cepat bila ada tabel non-InnoDB: tanpa transaksi, data bisnis bisa rusak setengah jalan.
await assertInnoDb(handle).catch((error: unknown) => {
  console.error(`[api] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
const app = createApp({ handle, config });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Naqdi API berjalan di http://${info.address}:${info.port}/api/v1 (${config.nodeEnv})`);
});

const shutdown = async () => {
  server.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
