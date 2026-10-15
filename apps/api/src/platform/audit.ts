import { newId, platformAudit, type DbHandle } from "@naqdi/db";

type Db = DbHandle["db"];

/** Mencatat tindakan pengelola atau peristiwa platform (hanya menambah). `adminId` null = sistem (mis. pendaftaran mandiri). */
export const recordPlatformEvent = async (db: Db, adminId: string | null, action: string, businessId: string | null, detail: Record<string, unknown> | null = null): Promise<void> => {
  await db.insert(platformAudit).values({ id: newId(), adminId, action, businessId, detail });
};
