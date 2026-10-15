import { and, count, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { newId, rolePrivileges, roles, users, type DbHandle } from "@naqdi/db";
import { accessTypes, hasAppAccess, hasBackofficeAccess, privileges, type AccessType, type Privilege } from "@naqdi/domain";
import { AppError } from "../errors";
import { patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";

type Db = DbHandle["db"];
const idParam = z.object({ id: z.string().uuid() });

const body = z.object({
  name: z.string().trim().min(1).max(120),
  accessType: z.enum(accessTypes),
  privileges: z.array(z.enum(privileges)).max(privileges.length),
});

/** Peran yang memberi akses ke suatu sisi harus punya hak dasarnya, kalau tidak penggunanya bisa masuk tetapi tidak bisa berbuat apa pun. */
const checkConsistency = (accessType: AccessType, privs: readonly Privilege[]): Record<string, string> | null => {
  if (hasBackofficeAccess(accessType) && !privs.includes("backoffice.view")) return { privileges: "roles.needBackoffice" };
  if (hasAppAccess(accessType) && !privs.includes("pos.sell")) return { privileges: "roles.needSell" };
  return null;
};

/** Hak akses karyawan: melihat daftar peran, membuat/mengubah/menghapus peran kustom. Peran bawaan tidak bisa diubah. Hak: employees.manage. */
export const roleRoutes = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("employees.manage"));

  app.get("/", async (c) => {
    const list = await c.get("repo").roles.list();
    const db = c.get("db");
    const counts = await db.select({ roleId: users.roleId, n: count() }).from(users).where(and(eq(users.businessId, c.get("auth").businessId), isNull(users.deletedAt))).groupBy(users.roleId);
    return c.json({
      items: list.map((r) => ({ id: r.id, systemKey: r.systemKey, name: r.name, accessType: r.accessType, isSystem: r.isSystem, privileges: r.privileges, users: counts.find((x) => x.roleId === r.id)?.n ?? 0 })),
      catalog: privileges,
    });
  });

  const duplicateName = async (db: Db, businessId: string, name: string, exceptId?: string) => {
    const rows = await db.select({ id: roles.id, name: roles.name }).from(roles).where(and(eq(roles.businessId, businessId), isNull(roles.deletedAt)));
    return rows.some((r) => r.id !== exceptId && (r.name ?? "").toLowerCase() === name.toLowerCase());
  };

  app.post("/", validate("json", body), async (c) => {
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const bad = checkConsistency(b.accessType, b.privileges);
    if (bad) throw new AppError("validation", { fields: bad });
    if (await duplicateName(db, auth.businessId, b.name)) throw new AppError("conflict", { fields: { name: "errors.duplicateName" } });
    const id = newId();
    const unique = [...new Set(b.privileges)];
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      await tx.insert(roles).values({ id, businessId: auth.businessId, name: b.name, accessType: b.accessType, isSystem: false });
      if (unique.length) await tx.insert(rolePrivileges).values(unique.map((privilege) => ({ roleId: id, privilege })));
      await writeAudit(tx, auth, { entityType: "role", entityId: id, action: "create", summary: b.name, changes: { accessType: b.accessType, privileges: unique } });
    });
    return c.json({ id, name: b.name, accessType: b.accessType, isSystem: false, systemKey: null, privileges: unique.sort(), users: 0 }, 201);
  });

  app.patch("/:id", validate("param", idParam), validate("json", patchSchema(body)), async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const current = (await c.get("repo").roles.list()).find((r) => r.id === id);
    if (!current) throw new AppError("not_found");
    if (current.isSystem) throw new AppError("conflict", { messageKey: "roles.systemLocked" });
    const accessType = patch.accessType ?? current.accessType;
    const privs = [...new Set(patch.privileges ?? (current.privileges as Privilege[]))];
    const bad = checkConsistency(accessType, privs);
    if (bad) throw new AppError("validation", { fields: bad });
    if (patch.name && (await duplicateName(db, auth.businessId, patch.name, id))) throw new AppError("conflict", { fields: { name: "errors.duplicateName" } });
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      await tx.update(roles).set({ ...(patch.name ? { name: patch.name } : {}), accessType }).where(eq(roles.id, id));
      if (patch.privileges) {
        await tx.delete(rolePrivileges).where(eq(rolePrivileges.roleId, id));
        if (privs.length) await tx.insert(rolePrivileges).values(privs.map((privilege) => ({ roleId: id, privilege })));
      }
      await writeAudit(tx, auth, { entityType: "role", entityId: id, action: "update", summary: patch.name ?? current.name ?? "", changes: { before: { accessType: current.accessType, privileges: current.privileges }, after: { accessType, privileges: privs.sort() } } });
    });
    const updated = (await c.get("repo").roles.list()).find((r) => r.id === id)!;
    return c.json({ id, name: updated.name, accessType: updated.accessType, isSystem: false, systemKey: null, privileges: updated.privileges });
  });

  app.delete("/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const current = (await c.get("repo").roles.list()).find((r) => r.id === id);
    if (!current) throw new AppError("not_found");
    if (current.isSystem) throw new AppError("conflict", { messageKey: "roles.systemLocked" });
    const [used] = await db.select({ n: count() }).from(users).where(and(eq(users.roleId, id), isNull(users.deletedAt)));
    if ((used?.n ?? 0) > 0) throw new AppError("conflict", { messageKey: "roles.inUse" });
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      await tx.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, id));
      await writeAudit(tx, auth, { entityType: "role", entityId: id, action: "delete", summary: current.name ?? "" });
    });
    return c.body(null, 204);
  });

  void sql;
  return app;
};
