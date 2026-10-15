import { Hono } from "hono";
import { z } from "zod";
import { newId, outlets, type DbHandle } from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { assignCatalogToOutlet, type AssignSummary } from "../repo/catalog-assign";
import { tenantRepo } from "../repo/tenant";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Zona waktu tidak dikenal");

const body = z.object({
  name: z.string().trim().min(1).max(191),
  address: z.string().trim().max(500).nullish(),
  phone: z.string().trim().max(32).nullish(),
  timezone: timezone.default("Asia/Jakarta"),
  status: z.enum(["active", "inactive"]).default("active"),
  /** Harga di outlet ini sudah termasuk pajak (true) atau pajak ditambahkan di atas harga (false). */
  pricesIncludeTax: z.boolean().default(false),
  /** Harga menu sudah termasuk service charge/gratuity. */
  pricesIncludeGratuity: z.boolean().default(false),
  /** Pajak juga dikenakan atas service charge. */
  taxOnGratuity: z.boolean().default(true),
  /** Kelipatan pembulatan total dalam satuan terkecil; 0 = tanpa pembulatan. */
  roundingStep: z.number().int().min(0).max(1_000_000).default(0),
  roundingMode: z.enum(["nearest", "up", "down"]).default("nearest"),
});

const createBody = body.extend({
  /** Outlet baru langsung memperoleh seluruh katalog yang ada (item, bundle, promo, pajak, dst.). */
  assignCatalog: z.boolean().default(true),
});

type OutletRow = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  status: "active" | "inactive";
  pricesIncludeTax: boolean;
  pricesIncludeGratuity: boolean;
  taxOnGratuity: boolean;
  roundingStep: number;
  roundingMode: "nearest" | "up" | "down";
  createdAt: Date;
  updatedAt: Date;
};

const present = (o: OutletRow) => ({
  id: o.id,
  name: o.name,
  address: o.address,
  phone: o.phone,
  timezone: o.timezone,
  status: o.status,
  pricesIncludeTax: o.pricesIncludeTax,
  pricesIncludeGratuity: o.pricesIncludeGratuity,
  taxOnGratuity: o.taxOnGratuity,
  roundingStep: o.roundingStep,
  roundingMode: o.roundingMode,
  createdAt: iso(o.createdAt),
  updatedAt: iso(o.updatedAt),
});

const duplicate = (error: unknown) => {
  if (duplicateKey(error)) return new AppError("conflict", { fields: { name: "outlets.duplicate" } });
  return error;
};

const snapshot = (o: OutletRow) => ({
  name: o.name,
  status: o.status,
  timezone: o.timezone,
  pricesIncludeTax: o.pricesIncludeTax,
  pricesIncludeGratuity: o.pricesIncludeGratuity,
  taxOnGratuity: o.taxOnGratuity,
  roundingStep: o.roundingStep,
  roundingMode: o.roundingMode,
});

export const outletRoutes = () => {
  const app = new Hono<AppEnv>();

  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const { page, pageSize, q } = c.req.valid("query");
    const { items, total } = await c.get("repo").outlets.list({ page, pageSize, q });
    return c.json({ items: items.map(present), total, page, pageSize });
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const outlet = await c.get("repo").outlets.get(c.req.valid("param").id);
    if (!outlet) throw new AppError("not_found");
    return c.json(present(outlet));
  });

  app.post("/", requirePrivilege("outlets.manage"), validate("json", createBody), async (c) => {
    const { assignCatalog, ...data } = c.req.valid("json");
    const db = c.get("db");
    const auth = c.get("auth");
    const id = newId();
    let assigned: AssignSummary | null = null;
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        await tenantRepo(t, auth.businessId).outlets.create({ id, ...data, address: data.address ?? null, phone: data.phone ?? null });
        if (assignCatalog) assigned = await assignCatalogToOutlet(t, auth.businessId, id);
        await writeAudit(t, auth, { entityType: "outlet", entityId: id, action: "create", summary: data.name, changes: { after: data, assignedCatalog: assigned } });
      });
    } catch (error) {
      throw duplicate(error);
    }
    const created = await c.get("repo").outlets.get(id);
    return c.json({ ...present(created!), assignedCatalog: assigned }, 201);
  });

  app.patch(
    "/:id",
    requirePrivilege("outlets.manage"),
    validate("param", idParam),
    validate("json", patchSchema(body)),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const repo = c.get("repo");
      const auth = c.get("auth");
      const before = await repo.outlets.get(id);
      if (!before) throw new AppError("not_found");
      try {
        await c.get("db").transaction(async (tx) => {
          const t = tx as unknown as Db;
          const scoped = tenantRepo(t, auth.businessId);
          if (Object.keys(data).length) await scoped.outlets.update(id, data);
          const after = (await scoped.outlets.get(id))!;
          await writeAudit(t, auth, {
            entityType: "outlet",
            entityId: id,
            action: "update",
            summary: after.name,
            changes: { before: snapshot(before), after: snapshot(after), taxModeChanged: before.pricesIncludeTax !== after.pricesIncludeTax || before.pricesIncludeGratuity !== after.pricesIncludeGratuity || before.taxOnGratuity !== after.taxOnGratuity || before.roundingStep !== after.roundingStep || before.roundingMode !== after.roundingMode },
          });
        });
      } catch (error) {
        throw duplicate(error);
      }
      return c.json(present((await repo.outlets.get(id))!));
    },
  );

  app.delete("/:id", requirePrivilege("outlets.manage"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const before = await c.get("repo").outlets.get(id);
    if (!before) throw new AppError("not_found");
    await c.get("db").transaction(async (tx) => {
      const t = tx as unknown as Db;
      await tenantRepo(t, auth.businessId).outlets.softDelete(id);
      await writeAudit(t, auth, { entityType: "outlet", entityId: id, action: "delete", summary: before.name, changes: { before: snapshot(before) } });
    });
    return c.body(null, 204);
  });

  return app;
};

export { outlets };
