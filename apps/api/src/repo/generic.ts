/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, count, eq, inArray, isNull, like } from "drizzle-orm";
import { outlets, type DbHandle } from "@naqdi/db";

type Db = DbHandle["db"];

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);
export const contains = (q: string) => `%${escapeLike(q.trim())}%`;

/** Id mana saja dari `ids` yang BUKAN milik bisnis ini (atau sudah dihapus) pada `table`. */
export const missingIn = async (db: Db, table: any, businessId: string, ids: string[]): Promise<string[]> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.businessId, businessId), isNull(table.deletedAt), inArray(table.id, unique)));
  const found = new Set((rows as Array<{ id: string }>).map((r) => r.id));
  return unique.filter((id) => !found.has(id));
};

export const activeOutletIds = async (db: Db, businessId: string): Promise<string[]> => {
  const rows = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), isNull(outlets.deletedAt)));
  return rows.map((r) => r.id);
};

/** Hubungan banyak-ke-banyak yang diganti utuh saat disimpan (mis. pajak <-> outlet). */
export interface LinkSpec {
  field: string;
  table: any;
  ownerCol: string;
  otherCol: string;
  /** Tabel sisi lain (punya businessId dan deletedAt) untuk memeriksa kepemilikan id. */
  target: any;
}

/**
 * Repository generik untuk entitas bernama milik bisnis (kategori, brand, pajak, ...).
 * Semua query menyertakan business_id dan menyaring baris terhapus.
 */
export const genericRepo = (db: Db, businessId: string, table: any, links: LinkSpec[] = []) => {
  const scope = (...extra: any[]) => and(eq(table.businessId, businessId), isNull(table.deletedAt), ...extra);

  const linkMap = async (ids: string[]) => {
    const result: Record<string, Map<string, string[]>> = {};
    for (const link of links) {
      const map = new Map<string, string[]>();
      if (ids.length) {
        const rows = (await db
          .select({ owner: link.table[link.ownerCol], other: link.table[link.otherCol] })
          .from(link.table)
          .where(inArray(link.table[link.ownerCol], ids))) as Array<{ owner: string; other: string }>;
        for (const r of rows) map.set(r.owner, [...(map.get(r.owner) ?? []), r.other]);
      }
      result[link.field] = map;
    }
    return result;
  };

  return {
    links,
    async list(p: { page: number; pageSize: number; q?: string | undefined }) {
      const where = scope(p.q ? like(table.name, contains(p.q)) : undefined);
      const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(table).where(where);
      const items = (await db
        .select()
        .from(table)
        .where(where)
        .orderBy(asc(table.name))
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize)) as any[];
      const maps = await linkMap(items.map((i) => i.id));
      return {
        total,
        items: items.map((i) => ({
          ...i,
          ...Object.fromEntries(links.map((l) => [l.field, maps[l.field]?.get(i.id) ?? []])),
        })),
      };
    },
    async get(id: string) {
      const [row] = (await db.select().from(table).where(scope(eq(table.id, id))).limit(1)) as any[];
      if (!row) return null;
      const maps = await linkMap([id]);
      return { ...row, ...Object.fromEntries(links.map((l) => [l.field, maps[l.field]?.get(id) ?? []])) };
    },
    async missingLinkIds(field: string, ids: string[]) {
      const link = links.find((l) => l.field === field);
      return link ? missingIn(db, link.target, businessId, ids) : [];
    },
    async create(values: Record<string, unknown>, linkValues: Record<string, string[]>) {
      await db.transaction(async (tx) => {
        await tx.insert(table).values({ ...values, businessId } as any);
        await replaceLinks(tx as unknown as Db, links, values.id as string, linkValues);
      });
    },
    async update(id: string, values: Record<string, unknown>, linkValues: Record<string, string[]>) {
      return db.transaction(async (tx) => {
        const [exists] = (await tx.select({ id: table.id }).from(table).where(scope(eq(table.id, id))).limit(1)) as any[];
        if (!exists) return false;
        if (Object.keys(values).length) await tx.update(table).set(values as any).where(scope(eq(table.id, id)));
        await replaceLinks(tx as unknown as Db, links, id, linkValues);
        return true;
      });
    },
    async softDelete(id: string) {
      const [res] = (await db.update(table).set({ deletedAt: new Date() } as any).where(scope(eq(table.id, id)))) as any[];
      return res.affectedRows > 0;
    },
  };
};

const replaceLinks = async (db: Db, links: LinkSpec[], ownerId: string, values: Record<string, string[]>) => {
  for (const link of links) {
    const ids = values[link.field];
    if (!ids) continue;
    await db.delete(link.table).where(eq(link.table[link.ownerCol], ownerId));
    const unique = [...new Set(ids)];
    if (unique.length) {
      await db.insert(link.table).values(unique.map((other) => ({ [link.ownerCol]: ownerId, [link.otherCol]: other })) as any);
    }
  }
};
