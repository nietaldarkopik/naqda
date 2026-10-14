import { sql } from "drizzle-orm";
import { datetime } from "drizzle-orm/mysql-core";
import { newId, uuid } from "../uuid";

/** Kolom id: UUIDv7 BINARY(16), dibuat otomatis di aplikasi. */
export const idColumn = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => newId());

/** Waktu disimpan UTC sebagai DATETIME(3) (bukan TIMESTAMP). Sesi koneksi diset ke +00:00. */
export const dt = (name: string) => datetime(name, { mode: "date", fsp: 3 });

export const timestamps = {
  createdAt: dt("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: dt("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
  deletedAt: dt("deleted_at"),
};
