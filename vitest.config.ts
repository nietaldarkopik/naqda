import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Di Windows huruf drive bisa datang sebagai "c:" atau "C:" tergantung cara shell dibuka. Bila root konfigurasi dan berkas tes
// berbeda huruf, vitest memuat dirinya dua kali dan SEMUA tes gagal dengan "Cannot read properties of undefined (reading 'config')".
// realpathSync.native mengembalikan huruf yang kanonik, sehingga hasilnya sama dari mana pun vitest dijalankan.
const root = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));
const p = (rel: string) => path.join(root, rel);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@naqdi/db": p("./packages/db/src/index.ts"),
      "@naqdi/domain": p("./packages/domain/src/index.ts"),
      "@naqdi/sync": p("./packages/sync/src/index.ts"),
      "@naqdi/hardware": p("./packages/hardware/src/index.ts"),
      "@naqdi/i18n": p("./packages/i18n/src/index.ts"),
    },
  },
  test: {
    projects: [
      {
        // Tes murni (aturan bisnis, katalog terjemahan): tidak butuh database.
        extends: true,
        test: { name: "unit", include: ["packages/**/test/**/*.test.ts"], testTimeout: 60_000 },
      },
      {
        // Tes API terhadap MySQL sungguhan. Skema dibuat sekali per proses (global-setup.ts);
        // berkas dijalankan berurutan karena berbagi satu database.
        extends: true,
        test: {
          name: "api",
          include: ["apps/api/test/**/*.test.ts"],
          fileParallelism: false,
          globalSetup: ["apps/api/test/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
