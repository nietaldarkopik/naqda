import { Hono } from "hono";
import { z } from "zod";
import { newId, type DbHandle } from "@naqdi/db";
import { hasBackofficeAccess, isValidPinFormat, isWeakPin } from "@naqdi/domain";
import { locales } from "@naqdi/i18n";
import { hashPasswordWith } from "../auth/password";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { slotsAvailable } from "../settings/service";
import { tenantRepo } from "../repo/tenant";

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

const password = z.string().min(8, "Minimal 8 karakter").max(200);

const createBody = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().toLowerCase().email().max(191),
  phone: z.string().trim().max(32).nullish(),
  roleId: z.string().uuid(),
  outletIds: z.array(z.string().uuid()).max(500).default([]),
  locale: z.enum(locales).nullish(),
  status: z.enum(["active", "inactive"]).default("active"),
  password: password.optional(),
});

const updateBody = patchSchema(createBody);

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string | null;
  status: "active" | "inactive" | "invited";
  lastLoginAt: Date | null;
  pinHash: string | null;
  createdAt: Date;
  role: { id: string; systemKey: string | null; name: string | null; accessType: string };
  outletIds: string[];
};

const present = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  locale: u.locale,
  status: u.status,
  lastLoginAt: iso(u.lastLoginAt),
  hasPin: Boolean(u.pinHash),
  createdAt: iso(u.createdAt),
  role: { id: u.role.id, systemKey: u.role.systemKey, name: u.role.name, accessType: u.role.accessType },
  outletIds: u.outletIds,
});

export const employeeRoutes = (bcryptCost: number) => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("employees.manage"));

  const assertRefs = async (c: import("hono").Context<AppEnv>, roleId: string | undefined, outletIds: string[] | undefined) => {
    const repo = c.get("repo");
    const fields: Record<string, string> = {};
    if (roleId && !(await repo.roles.get(roleId))) fields.roleId = "errors.notFound";
    if (outletIds && (await repo.outlets.missing(outletIds)).length) fields.outletIds = "errors.notFound";
    if (Object.keys(fields).length) throw new AppError("validation", { fields });
  };

  const dup = (error: unknown) =>
    duplicateKey(error) ? new AppError("conflict", { fields: { email: "employees.duplicateEmail" } }) : error;

  app.get("/", validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const { items, total } = await c.get("repo").users.list({ page, pageSize, q });
    return c.json({ items: items.map(present), total, page, pageSize });
  });

  app.get("/:id", validate("param", idParam), async (c) => {
    const user = await c.get("repo").users.get(c.req.valid("param").id);
    if (!user) throw new AppError("not_found");
    return c.json(present(user));
  });

  app.post("/", validate("json", createBody), async (c) => {
    const data = c.req.valid("json");
    await assertRefs(c, data.roleId, data.outletIds);
    const repo = c.get("repo");
    if (data.status !== "inactive" && !(await slotsAvailable(c.get("db"), c.get("auth").businessId))) throw new AppError("conflict", { messageKey: "settings.slotsFull" });
    const role = (await repo.roles.get(data.roleId))!;
    // Peran dengan akses back office wajib punya kata sandi agar bisa masuk.
    if (hasBackofficeAccess(role.accessType) && !data.password) {
      throw new AppError("validation", { fields: { password: "common.required" } });
    }
    const id = newId();
    try {
      await repo.users.create(
        {
          id,
          name: data.name,
          email: data.email,
          phone: data.phone ?? null,
          roleId: data.roleId,
          locale: data.locale ?? null,
          status: data.status,
          passwordHash: data.password ? await hashPasswordWith(data.password, bcryptCost) : null,
        },
        data.outletIds,
      );
    } catch (error) {
      throw dup(error);
    }
    return c.json(present((await repo.users.get(id))!), 201);
  });

  app.patch("/:id", validate("param", idParam), validate("json", updateBody), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const repo = c.get("repo");
    const existing = await repo.users.get(id);
    if (!existing) throw new AppError("not_found");
    await assertRefs(c, data.roleId, data.outletIds);
    // Mengaktifkan kembali karyawan yang nonaktif memakai satu slot.
    if (data.status && data.status !== "inactive" && existing.status === "inactive" && !(await slotsAvailable(c.get("db"), c.get("auth").businessId, id))) {
      throw new AppError("conflict", { messageKey: "settings.slotsFull" });
    }

    const { password: newPassword, outletIds, ...rest } = data;
    const patch: Record<string, unknown> = { ...rest };
    if (newPassword) patch.passwordHash = await hashPasswordWith(newPassword, bcryptCost);
    if ("phone" in patch) patch.phone = patch.phone ?? null;
    if ("locale" in patch) patch.locale = patch.locale ?? null;

    // Jangan sampai admin mengunci dirinya sendiri.
    if (id === c.get("auth").userId && (data.status === "inactive" || data.roleId)) {
      throw new AppError("conflict", { messageKey: "errors.forbidden" });
    }
    try {
      await repo.users.update(id, patch, outletIds);
    } catch (error) {
      throw dup(error);
    }
    return c.json(present((await repo.users.get(id))!));
  });

  app.delete("/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    if (id === c.get("auth").userId) throw new AppError("conflict", { messageKey: "errors.forbidden" });
    const ok = await c.get("repo").users.softDelete(id);
    if (!ok) throw new AppError("not_found");
    return c.body(null, 204);
  });

  // PIN kasir: hanya hash yang disimpan; PIN tidak pernah dikembalikan atau dicatat di audit.
  app.post("/:id/pin", validate("param", idParam), validate("json", z.object({ pin: z.string().max(32) })), async (c) => {
    const { id } = c.req.valid("param");
    const { pin } = c.req.valid("json");
    const auth = c.get("auth");
    const user = await c.get("repo").users.get(id);
    if (!user) throw new AppError("not_found");
    if (!isValidPinFormat(pin)) throw new AppError("validation", { fields: { pin: "pos.pinFormat" } });
    if (isWeakPin(pin)) throw new AppError("validation", { fields: { pin: "pos.pinWeak" } });
    const pinHash = await hashPasswordWith(pin, bcryptCost);
    await c.get("db").transaction(async (tx) => {
      const t = tx as unknown as DbHandle["db"];
      await tenantRepo(t, auth.businessId).users.update(id, { pinHash, pinFailures: 0, pinLockedUntil: null });
      await writeAudit(t, auth, { entityType: "user_pin", entityId: id, action: "update", summary: user.name, changes: { pinSet: true } });
    });
    return c.body(null, 204);
  });

  app.delete("/:id/pin", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const user = await c.get("repo").users.get(id);
    if (!user) throw new AppError("not_found");
    await c.get("db").transaction(async (tx) => {
      const t = tx as unknown as DbHandle["db"];
      await tenantRepo(t, auth.businessId).users.update(id, { pinHash: null, pinFailures: 0, pinLockedUntil: null });
      await writeAudit(t, auth, { entityType: "user_pin", entityId: id, action: "delete", summary: user.name, changes: { pinSet: false } });
    });
    return c.body(null, 204);
  });

  return app;
};
