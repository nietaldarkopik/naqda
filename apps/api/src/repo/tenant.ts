import { and, asc, count, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import {
  outlets,
  rolePrivileges,
  roles,
  userOutlets,
  users,
  type DbHandle,
} from "@naqdi/db";

type Db = DbHandle["db"];

export interface Page {
  page: number;
  pageSize: number;
  q?: string | undefined;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);
const contains = (q: string) => `%${escapeLike(q.trim())}%`;
const offset = (p: Page) => (p.page - 1) * p.pageSize;

/**
 * Satu-satunya pintu akses data bisnis. Setiap query otomatis disaring `business_id`
 * dan baris yang belum dihapus. MySQL tidak punya Row-Level Security, jadi aturan ini
 * dijaga di sini (doc 02, bagian 2). Jangan menulis query ke tabel tenant di luar berkas ini.
 */
export const tenantRepo = (db: Db, businessId: string) => {
  const outletScope = (...extra: Array<SQL | undefined>) =>
    and(eq(outlets.businessId, businessId), isNull(outlets.deletedAt), ...extra);
  const userScope = (...extra: Array<SQL | undefined>) =>
    and(eq(users.businessId, businessId), isNull(users.deletedAt), ...extra);
  const roleScope = (...extra: Array<SQL | undefined>) =>
    and(eq(roles.businessId, businessId), isNull(roles.deletedAt), ...extra);

  return {
    businessId,

    outlets: {
      async list(p: Page) {
        const where = outletScope(p.q ? or(like(outlets.name, contains(p.q)), like(outlets.address, contains(p.q))) : undefined);
        const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(outlets).where(where);
        const items = await db
          .select()
          .from(outlets)
          .where(where)
          .orderBy(asc(outlets.name))
          .limit(p.pageSize)
          .offset(offset(p));
        return { items, total };
      },
      async get(id: string) {
        const [row] = await db.select().from(outlets).where(outletScope(eq(outlets.id, id))).limit(1);
        return row ?? null;
      },
      /** Memastikan semua id outlet milik bisnis ini; mengembalikan yang tidak valid. */
      async missing(ids: string[]) {
        if (ids.length === 0) return [];
        const rows = await db.select({ id: outlets.id }).from(outlets).where(outletScope(inArray(outlets.id, ids)));
        const found = new Set(rows.map((r) => r.id));
        return ids.filter((id) => !found.has(id));
      },
      async create(data: Omit<typeof outlets.$inferInsert, "businessId">) {
        await db.insert(outlets).values({ ...data, businessId });
      },
      async update(id: string, data: Partial<Omit<typeof outlets.$inferInsert, "id" | "businessId">>) {
        const [res] = await db.update(outlets).set(data).where(outletScope(eq(outlets.id, id)));
        return res.affectedRows > 0;
      },
      async softDelete(id: string) {
        const [res] = await db.update(outlets).set({ deletedAt: new Date() }).where(outletScope(eq(outlets.id, id)));
        return res.affectedRows > 0;
      },
    },

    roles: {
      async list() {
        const rows = await db.select().from(roles).where(roleScope()).orderBy(asc(roles.createdAt));
        const ids = rows.map((r) => r.id);
        const privs = ids.length
          ? await db.select().from(rolePrivileges).where(inArray(rolePrivileges.roleId, ids))
          : [];
        return rows.map((r) => ({
          ...r,
          privileges: privs.filter((p) => p.roleId === r.id).map((p) => p.privilege).sort(),
        }));
      },
      async get(id: string) {
        const [row] = await db.select().from(roles).where(roleScope(eq(roles.id, id))).limit(1);
        return row ?? null;
      },
    },

    users: {
      async list(p: Page) {
        const where = userScope(p.q ? or(like(users.name, contains(p.q)), like(users.email, contains(p.q))) : undefined);
        const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(users).where(where);
        const rows = await db
          .select({ user: users, role: roles })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(where)
          .orderBy(asc(users.name))
          .limit(p.pageSize)
          .offset(offset(p));
        const outletMap = await outletIdsFor(rows.map((r) => r.user.id));
        return {
          items: rows.map((r) => ({ ...r.user, role: r.role, outletIds: outletMap.get(r.user.id) ?? [] })),
          total,
        };
      },
      async get(id: string) {
        const [row] = await db
          .select({ user: users, role: roles })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(userScope(eq(users.id, id)))
          .limit(1);
        if (!row) return null;
        const outletMap = await outletIdsFor([id]);
        return { ...row.user, role: row.role, outletIds: outletMap.get(id) ?? [] };
      },
      async create(data: Omit<typeof users.$inferInsert, "businessId">, outletIds: string[]) {
        await db.transaction(async (tx) => {
          await tx.insert(users).values({ ...data, businessId });
          if (outletIds.length && data.id) {
            await tx.insert(userOutlets).values(outletIds.map((outletId) => ({ userId: data.id!, outletId })));
          }
        });
      },
      async update(
        id: string,
        data: Partial<Omit<typeof users.$inferInsert, "id" | "businessId">>,
        outletIds?: string[],
      ) {
        return db.transaction(async (tx) => {
          const [res] = await tx.update(users).set(data).where(userScope(eq(users.id, id)));
          if (res.affectedRows === 0) {
            const [exists] = await tx.select({ id: users.id }).from(users).where(userScope(eq(users.id, id))).limit(1);
            if (!exists) return false;
          }
          if (outletIds) {
            await tx.delete(userOutlets).where(eq(userOutlets.userId, id));
            if (outletIds.length) await tx.insert(userOutlets).values(outletIds.map((outletId) => ({ userId: id, outletId })));
          }
          return true;
        });
      },
      async softDelete(id: string) {
        const [res] = await db.update(users).set({ deletedAt: new Date() }).where(userScope(eq(users.id, id)));
        return res.affectedRows > 0;
      },
    },
  };

  async function outletIdsFor(userIds: string[]) {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;
    // user_outlets tidak punya business_id; keamanannya dijamin karena userIds berasal dari query bertenant.
    const rows = await db
      .select({ userId: userOutlets.userId, outletId: userOutlets.outletId })
      .from(userOutlets)
      .innerJoin(outlets, and(eq(userOutlets.outletId, outlets.id), eq(outlets.businessId, businessId), isNull(outlets.deletedAt)))
      .where(inArray(userOutlets.userId, userIds));
    for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r.outletId]);
    return map;
  }
};

export type TenantRepo = ReturnType<typeof tenantRepo>;

/** Dipakai hanya oleh alur login (sebelum konteks bisnis diketahui). Tidak tersedia untuk rute lain. */
export const authQueries = (db: Db) => ({
  async findLoginUser(email: string) {
    const [row] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.activeEmail, email.toLowerCase()), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  },
  async findUserForRefresh(userId: string) {
    const [row] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  },
  async privilegesOf(roleId: string) {
    const rows = await db.select({ p: rolePrivileges.privilege }).from(rolePrivileges).where(eq(rolePrivileges.roleId, roleId));
    return rows.map((r) => r.p);
  },
  async outletsOf(userId: string, businessId: string) {
    return db
      .select({ id: outlets.id, name: outlets.name })
      .from(userOutlets)
      .innerJoin(outlets, eq(userOutlets.outletId, outlets.id))
      .where(and(eq(userOutlets.userId, userId), eq(outlets.businessId, businessId), isNull(outlets.deletedAt)))
      .orderBy(asc(outlets.name));
  },
  touchLogin: (userId: string) => db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)),
});

export { sql };
