import { compare } from "bcryptjs";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { roles, userOutlets, users, type DbHandle } from "@naqdi/db";
import { isPrivilege, lockoutSeconds, type Privilege } from "@naqdi/domain";
import { AppError } from "../errors";
import { authQueries } from "../repo/tenant";

type Db = DbHandle["db"];

// Hash palsu agar waktu respons tidak membedakan "pengguna tidak ada" dari "PIN salah".
const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8o0C9Q9A8m2qf6y3n1p0cKQ1m9o5eC";

export interface VerifiedUser {
  user: typeof users.$inferSelect;
  role: typeof roles.$inferSelect;
}

/**
 * Memeriksa PIN seorang pengguna yang ditugaskan di outlet ini (login kasir dan persetujuan atasan memakai jalur yang sama,
 * jadi penguncian per-pengguna berlaku untuk keduanya). Melempar 401 (PIN salah/pengguna tak dikenal) atau 423 (terkunci).
 */
export const verifyPin = async (
  db: Db,
  scope: { businessId: string; outletId: string },
  userId: string,
  pin: string,
  options: { touchLogin?: boolean } = {},
): Promise<VerifiedUser> => {
  const [row] = await db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(userOutlets, and(eq(userOutlets.userId, users.id), eq(userOutlets.outletId, scope.outletId)))
    .where(and(eq(users.id, userId), eq(users.businessId, scope.businessId), isNull(users.deletedAt), eq(users.status, "active"), ne(roles.accessType, "backoffice_only")))
    .limit(1);

  if (!row || !row.user.pinHash) {
    await compare(pin, dummyHash);
    throw new AppError("unauthorized", { messageKey: "pos.pinInvalid" });
  }

  const lockedUntil = row.user.pinLockedUntil;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw new AppError("locked", { extra: { retryAfterSeconds: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000) } });
  }

  if (!(await compare(pin, row.user.pinHash))) {
    // Penambahan atomik di SQL agar percobaan paralel tidak melewati batas.
    await db.update(users).set({ pinFailures: sql`${users.pinFailures} + 1` }).where(eq(users.id, userId));
    const [after] = await db.select({ failures: users.pinFailures }).from(users).where(eq(users.id, userId)).limit(1);
    const seconds = lockoutSeconds(after?.failures ?? 0);
    if (seconds > 0) {
      await db.update(users).set({ pinLockedUntil: new Date(Date.now() + seconds * 1000) }).where(eq(users.id, userId));
      throw new AppError("locked", { extra: { retryAfterSeconds: seconds } });
    }
    throw new AppError("unauthorized", { messageKey: "pos.pinInvalid" });
  }

  await db
    .update(users)
    .set({ pinFailures: 0, pinLockedUntil: null, ...(options.touchLogin ? { lastLoginAt: new Date() } : {}) })
    .where(eq(users.id, userId));
  return { user: row.user, role: row.role };
};

export const privilegesOfRole = async (db: Db, roleId: string): Promise<Privilege[]> => (await authQueries(db).privilegesOf(roleId)).filter(isPrivilege);
