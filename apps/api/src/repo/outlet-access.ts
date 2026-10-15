import { and, asc, eq, isNull } from "drizzle-orm";
import { outlets, userOutlets, type DbHandle } from "@naqdi/db";
import { AppError } from "../errors";

type Db = DbHandle["db"];

export interface AccessibleOutlet {
  id: string;
  name: string;
  timezone: string;
}

/** Outlet yang ditugaskan kepada pengguna ini (batas akses data per outlet di Back Office). */
export const assignedOutlets = (db: Db, auth: { userId: string; businessId: string }): Promise<AccessibleOutlet[]> =>
  db
    .select({ id: outlets.id, name: outlets.name, timezone: outlets.timezone })
    .from(userOutlets)
    .innerJoin(outlets, eq(userOutlets.outletId, outlets.id))
    .where(and(eq(userOutlets.userId, auth.userId), eq(outlets.businessId, auth.businessId), isNull(outlets.deletedAt)))
    .orderBy(asc(outlets.name));

/** Memastikan outlet termasuk yang ditugaskan; selain itu 403 (bukan 404, agar tidak membocorkan keberadaan outlet). */
export const requireOutletAccess = async (db: Db, auth: { userId: string; businessId: string }, outletId: string): Promise<AccessibleOutlet> => {
  const found = (await assignedOutlets(db, auth)).find((o) => o.id === outletId);
  if (!found) throw new AppError("forbidden");
  return found;
};
