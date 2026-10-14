import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@naqdi/db": p("./packages/db/src/index.ts"),
      "@naqdi/domain": p("./packages/domain/src/index.ts"),
      "@naqdi/i18n": p("./packages/i18n/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/api/test/**/*.test.ts"],
    // Tes API memakai satu database bersama, jadi file dijalankan berurutan.
    fileParallelism: false,
    // Membuat ulang database tes sekali per proses (bukan per berkas).
    globalSetup: ["apps/api/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
