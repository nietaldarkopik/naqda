import { migrate } from "drizzle-orm/mysql2/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export const runMigrations = async (url: string): Promise<void> => {
  const handle = createDb(url, { connectionLimit: 2 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
};
