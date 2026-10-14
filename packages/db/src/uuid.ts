import { customType } from "drizzle-orm/mysql-core";
import { v7 as uuidv7 } from "uuid";

/** UUIDv7 baru (berurutan menurut waktu, sehingga indeks InnoDB tetap rapat). */
export const newId = (): string => uuidv7();

const toBuffer = (id: string): Buffer => {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new TypeError(`UUID tidak valid: ${id}`);
  return Buffer.from(hex, "hex");
};

const fromBuffer = (buf: Buffer | Uint8Array): string => {
  const h = Buffer.from(buf).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** UUID disimpan BINARY(16) (doc 02, bagian 3.0), dipakai sebagai string di kode. */
export const uuid = customType<{ data: string; driverData: Buffer }>({
  dataType: () => "binary(16)",
  toDriver: (value) => toBuffer(value),
  fromDriver: (value) => fromBuffer(value),
});

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
