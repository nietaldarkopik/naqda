/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { z, type ZodObject, type ZodRawShape } from "zod";
import { newId } from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { activeOutletIds, genericRepo, type LinkSpec } from "../repo/generic";
import { writeAudit } from "../repo/audit";

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

export interface SimpleConfig {
  /** Nama entitas untuk jejak audit, mis. "tax". */
  entity: string;
  table: any;
  /** Bidang yang boleh diubah (tanpa id/outlet). Skema create; PATCH memakai patchSchema (tanpa nilai bawaan). */
  schema: ZodObject<ZodRawShape>;
  links?: LinkSpec[];
  /** Nama bidang hubungan outlet yang mendukung `allOutlets: true`. */
  outletField?: string;
  /** Bidang tambahan yang dipresentasikan (selain id, name, dan hubungan). */
  fields: string[];
  /** Aturan lintas bidang; menerima data gabungan (data lama + perubahan). Mengembalikan galat per bidang atau null. */
  check?: (merged: Record<string, unknown>) => Record<string, string> | null;
}

/** Membuat router CRUD untuk entitas bernama milik bisnis. Hak tulis: library.manage. */
export const simpleRoutes = (cfg: SimpleConfig) => {
  const app = new Hono<AppEnv>();
  const linkFields = (cfg.links ?? []).map((l) => l.field);
  const bodySchema = cfg.outletField ? cfg.schema.extend({ allOutlets: z.boolean().optional() }) : cfg.schema;

  const present = (row: any) => ({
    id: row.id,
    name: row.name,
    ...Object.fromEntries(cfg.fields.map((f) => [f, row[f]])),
    ...Object.fromEntries(linkFields.map((f) => [f, row[f] ?? []])),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const split = (data: Record<string, unknown>) => {
    const values: Record<string, unknown> = {};
    const linkValues: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "allOutlets") continue;
      if (linkFields.includes(key)) linkValues[key] = value as string[];
      else values[key] = value;
    }
    return { values, linkValues };
  };

  const resolveLinks = async (c: any, data: Record<string, unknown>, linkValues: Record<string, string[]>) => {
    const { auth, db } = { auth: c.get("auth"), db: c.get("db") };
    if (cfg.outletField && data.allOutlets === true) linkValues[cfg.outletField] = await activeOutletIds(db, auth.businessId);
    const repo = genericRepo(db, auth.businessId, cfg.table, cfg.links);
    const fields: Record<string, string> = {};
    for (const [field, ids] of Object.entries(linkValues)) {
      if ((await repo.missingLinkIds(field, ids)).length) fields[field] = "errors.notFound";
    }
    if (Object.keys(fields).length) throw new AppError("validation", { fields });
  };

  const conflict = (error: unknown) =>
    duplicateKey(error) ? new AppError("conflict", { fields: { name: "errors.duplicateName" } }) : error;

  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const repo = genericRepo(c.get("db"), c.get("auth").businessId, cfg.table, cfg.links);
    const { items, total } = await repo.list({ page, pageSize, q });
    return c.json({ items: items.map(present), total, page, pageSize });
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const repo = genericRepo(c.get("db"), c.get("auth").businessId, cfg.table, cfg.links);
    const row = await repo.get(c.req.valid("param").id);
    if (!row) throw new AppError("not_found");
    return c.json(present(row));
  });

  app.post("/", requirePrivilege("library.manage"), validate("json", bodySchema), async (c) => {
    const data = c.req.valid("json") as Record<string, unknown>;
    const { values, linkValues } = split(data);
    await resolveLinks(c, data, linkValues);
    const id = newId();
    const db = c.get("db");
    const auth = c.get("auth");
    const invalid = cfg.check?.(values);
    if (invalid) throw new AppError("validation", { fields: invalid });
    try {
      await db.transaction(async (tx) => {
        const repo = genericRepo(tx as any, auth.businessId, cfg.table, cfg.links);
        await repo.create({ id, ...values }, linkValues);
        await writeAudit(tx as any, auth, { entityType: cfg.entity, entityId: id, action: "create", summary: String(values.name), changes: { after: values } });
      });
    } catch (error) {
      throw conflict(error);
    }
    const row = await genericRepo(db, auth.businessId, cfg.table, cfg.links).get(id);
    return c.json(present(row), 201);
  });

  app.patch(
    "/:id",
    requirePrivilege("library.manage"),
    validate("param", idParam),
    validate("json", patchSchema(bodySchema)),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json") as Record<string, unknown>;
      const { values, linkValues } = split(data);
      const db = c.get("db");
      const auth = c.get("auth");
      const before = await genericRepo(db, auth.businessId, cfg.table, cfg.links).get(id);
      if (!before) throw new AppError("not_found");
      const invalid = cfg.check?.({ ...before, ...values });
      if (invalid) throw new AppError("validation", { fields: invalid });
      await resolveLinks(c, data, linkValues);
      try {
        await db.transaction(async (tx) => {
          const repo = genericRepo(tx as any, auth.businessId, cfg.table, cfg.links);
          await repo.update(id, values, linkValues);
          const changed: Record<string, { from: unknown; to: unknown }> = {};
          for (const [k, v] of Object.entries(values)) if (before[k] !== v) changed[k] = { from: before[k], to: v };
          await writeAudit(tx as any, auth, { entityType: cfg.entity, entityId: id, action: "update", summary: String(before.name), changes: { changed, links: linkValues } });
        });
      } catch (error) {
        throw conflict(error);
      }
      return c.json(present(await genericRepo(db, auth.businessId, cfg.table, cfg.links).get(id)));
    },
  );

  app.delete("/:id", requirePrivilege("library.manage"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const auth = c.get("auth");
    const before = await genericRepo(db, auth.businessId, cfg.table, cfg.links).get(id);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      await genericRepo(tx as any, auth.businessId, cfg.table, cfg.links).softDelete(id);
      await writeAudit(tx as any, auth, { entityType: cfg.entity, entityId: id, action: "delete", summary: String(before.name), changes: { before: { name: before.name } } });
    });
    return c.body(null, 204);
  });

  return app;
};
