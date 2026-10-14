import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Memuat .env di root repo bila ada. Variabel yang sudah ada di lingkungan tidak ditimpa. */
export const loadEnv = (): void => {
  if (existsSync(rootEnv)) config({ path: rootEnv, quiet: true });
};

export const defaultDatabaseUrl = "mysql://root:@127.0.0.1:3306/naqdi";
