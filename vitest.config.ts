import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@naqdi/db": p("./packages/db/src/index.ts"),
      "@naqdi/domain": p("./packages/domain/src/index.ts"),
      "@naqdi/sync": p("./packages/sync/src/index.ts"),
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
