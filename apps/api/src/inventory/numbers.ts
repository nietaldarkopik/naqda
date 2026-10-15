import { and, eq, sql } from "drizzle-orm";
import { counters, type DbHandle } from "@naqdi/db";

type Db = DbHandle["db"];

/** Nomor dokumen berurutan per outlet dan jenis (po, tr, adj). Baris penghitung dikunci sampai transaksi selesai: tanpa celah. */
export const nextNumber = async (tx: Db, outletId: string, kind: string): Promise<number> => {
  await tx.insert(counters).values({ outletId, kind, value: 1 }).onDuplicateKeyUpdate({ set: { value: sql`${counters.value} + 1` } });
  const [c] = await tx.select({ value: counters.value }).from(counters).where(and(eq(counters.outletId, outletId), eq(counters.kind, kind))).limit(1);
  return c!.value;
};
