import { auditLogs, newId, type DbHandle } from "@naqdi/db";
import type { AuthContext } from "../auth/tokens";

type Db = DbHandle["db"];

export interface AuditEntry {
  entityType: string;
  entityId?: string | null;
  action: "create" | "update" | "delete" | "import";
  summary?: string;
  changes?: Record<string, unknown> | null;
}

/**
 * Mencatat jejak perubahan. Hanya menambah baris; tidak ada fungsi ubah atau hapus.
 * Dipanggil di dalam transaksi yang sama dengan perubahannya agar tidak ada perubahan tanpa jejak.
 */
export const writeAudit = async (db: Db, auth: AuthContext, entry: AuditEntry): Promise<void> => {
  await db.insert(auditLogs).values({
    id: newId(),
    businessId: auth.businessId,
    userId: auth.userId,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    action: entry.action,
    summary: entry.summary?.slice(0, 500) ?? null,
    changes: entry.changes ?? null,
  });
};
