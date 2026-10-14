import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./packages/db/src/schema/index.ts",
  out: "./packages/db/migrations",
  // generate tidak memerlukan koneksi; URL dipakai bila kelak memakai drizzle-kit push/studio.
  dbCredentials: { url: process.env.DATABASE_URL ?? "mysql://root:@127.0.0.1:3306/naqdi" },
});
