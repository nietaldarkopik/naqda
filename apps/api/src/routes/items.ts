import { and, asc, eq, isNull, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { itemVariants, items } from "@naqdi/db";
import { barcodeProblem, parseCsvTable, toCsv, CsvError } from "@naqdi/domain";
import { contains } from "../repo/generic";
import { AppError, duplicateKey } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import {
  assertItemRefs,
  createItem,
  getItem,
  listItems,
  pricesChanged,
  RefError,
  snapshotItem,
  softDeleteItem,
  updateItem,
  type ItemInput,
} from "../repo/items";
import { exportItemsCsv, importItemsCsv } from "../repo/items-csv";
import { imagePrefix } from "./files";

const idParam = z.object({ id: z.string().uuid() });
const uuid = z.string().uuid();
const money = z.number().int().min(0).max(9_000_000_000_000);

const variantSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(191),
  sku: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => (v ? v : null)),
  /** Barcode: satu per varian. Kosong = tanpa barcode; tidak dikirim = biarkan yang ada (PATCH aman untuk klien lama). */
  barcode: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .superRefine((v, ctx) => {
      const problem = v ? barcodeProblem(v) : null;
      if (problem) ctx.addIssue({ code: "custom", message: problem === "ean13_checksum" ? "catalog.barcodeChecksum" : "catalog.barcodeInvalid" });
    })
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  basePrice: money,
  cost: money.default(0),
  prices: z
    .array(z.object({ salesTypeId: uuid, price: money }))
    .max(100)
    .default([])
    .refine((list) => new Set(list.map((p) => p.salesTypeId)).size === list.length, "Sales type ganda"),
});

const variantsSchema = z
  .array(variantSchema)
  .min(1)
  .max(100)
  .refine((list) => new Set(list.map((v) => v.name.toLowerCase())).size === list.length, "Nama varian ganda")
  .refine((list) => {
    const skus = list.map((v) => v.sku).filter(Boolean);
    return new Set(skus).size === skus.length;
  }, "SKU ganda")
  .refine((list) => {
    const codes = list.map((v) => v.barcode?.toLowerCase()).filter(Boolean);
    return new Set(codes).size === codes.length;
  }, "catalog.barcodeDuplicate");

const itemBody = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(1000).nullish(),
  imageUrl: z.string().trim().max(500).nullish(),
  categoryId: uuid.nullish(),
  brandId: uuid.nullish(),
  trackStock: z.boolean().default(false),
  status: z.enum(["active", "inactive"]).default("active"),
  variants: variantsSchema,
  modifierSetIds: z.array(uuid).max(100).default([]),
  outletIds: z.array(uuid).max(500).optional(),
  allOutlets: z.boolean().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  categoryId: uuid.optional(),
  status: z.enum(["active", "inactive"]).optional(),
  outletId: uuid.optional(),
});

const importBody = z.object({
  csv: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().default(false),
});

const present = (i: NonNullable<Awaited<ReturnType<typeof getItem>>>) => ({
  ...i,
  createdAt: iso(i.createdAt),
  updatedAt: iso(i.updatedAt),
});

const toInput = (data: z.infer<typeof itemBody> | Partial<z.infer<typeof itemBody>>): ItemInput => data as ItemInput;

/** Gambar hanya boleh berasal dari unggahan bisnis ini (bukan URL luar), mencegah pelacakan dan konten yang tidak dikendalikan. */
const assertOwnImage = (businessId: string, imageUrl: string | null | undefined) => {
  if (imageUrl && !imageUrl.startsWith(imagePrefix(businessId))) {
    throw new AppError("validation", { fields: { imageUrl: "catalog.imageType" } });
  }
};

export const itemRoutes = () => {
  const app = new Hono<AppEnv>();

  app.get("/", requirePrivilege("backoffice.view"), validate("query", listQuery), async (c) => {
    const q = c.req.valid("query");
    const { items, total } = await listItems(c.get("db"), c.get("auth").businessId, q);
    return c.json({
      items: items.map((i) => ({ ...i, updatedAt: iso(i.updatedAt) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  // Daftar varian datar untuk pemilih (mis. bundle). Dideklarasikan sebelum "/:id".
  app.get(
    "/variants",
    requirePrivilege("backoffice.view"),
    validate("query", z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })),
    async (c) => {
      const { q, limit } = c.req.valid("query");
      const bid = c.get("auth").businessId;
      const rows = await c
        .get("db")
        .select({ id: itemVariants.id, itemId: items.id, itemName: items.name, name: itemVariants.name, sku: itemVariants.sku, barcode: itemVariants.barcode, basePrice: itemVariants.basePrice })
        .from(itemVariants)
        .innerJoin(items, eq(itemVariants.itemId, items.id))
        .where(
          and(
            eq(itemVariants.businessId, bid),
            isNull(itemVariants.deletedAt),
            isNull(items.deletedAt),
            q ? or(like(items.name, contains(q)), like(itemVariants.name, contains(q)), like(itemVariants.sku, contains(q)), like(itemVariants.barcode, contains(q))) : undefined,
          ),
        )
        .orderBy(asc(items.name), asc(itemVariants.position))
        .limit(limit);
      return c.json({ items: rows });
    },
  );

  // Dideklarasikan sebelum "/:id" agar "export" tidak dianggap id.
  app.get("/export", requirePrivilege("backoffice.view"), async (c) => {
    const csv = await exportItemsCsv(c.get("db"), c.get("auth").businessId);
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="naqdi-items.csv"',
      },
    });
  });

  app.post("/import", requirePrivilege("library.manage"), validate("json", importBody), async (c) => {
    const { csv, dryRun } = c.req.valid("json");
    try {
      parseCsvTable(csv);
    } catch (e) {
      if (e instanceof CsvError) throw new AppError("validation", { fields: { csv: "errors.validation" } });
      throw e;
    }
    const report = await importItemsCsv(c.get("db"), c.get("auth"), csv, dryRun);
    return c.json(report, report.errors.length ? 422 : 200);
  });

  app.get("/:id", requirePrivilege("backoffice.view"), validate("param", idParam), async (c) => {
    const item = await getItem(c.get("db"), c.get("auth").businessId, c.req.valid("param").id);
    if (!item) throw new AppError("not_found");
    return c.json(present(item));
  });

  app.post("/", requirePrivilege("library.manage"), validate("json", itemBody), async (c) => {
    const data = toInput(c.req.valid("json"));
    const db = c.get("db");
    const auth = c.get("auth");
    assertOwnImage(auth.businessId, data.imageUrl);
    let id = "";
    try {
      await assertItemRefs(db, auth.businessId, data);
      await db.transaction(async (tx) => {
        const t = tx as unknown as typeof db;
        id = await createItem(t, auth.businessId, data);
        const created = (await getItem(t, auth.businessId, id))!;
        await writeAudit(t, auth, { entityType: "item", entityId: id, action: "create", summary: created.name, changes: { after: snapshotItem(created) } });
      });
    } catch (error) {
      if (error instanceof RefError) throw new AppError("validation", { fields: error.fields });
      if (duplicateKey(error)) throw new AppError("conflict", { fields: { variants: (duplicateKey(error) ?? "").includes("barcode") ? "catalog.barcodeDuplicate" : "catalog.skuDuplicate" } });
      throw error;
    }
    return c.json(present((await getItem(db, auth.businessId, id))!), 201);
  });

  app.patch(
    "/:id",
    requirePrivilege("library.manage"),
    validate("param", idParam),
    validate("json", patchSchema(itemBody)),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = toInput(c.req.valid("json"));
      const db = c.get("db");
      const auth = c.get("auth");
      const before = await getItem(db, auth.businessId, id);
      if (!before) throw new AppError("not_found");
      assertOwnImage(auth.businessId, data.imageUrl);
      try {
        await assertItemRefs(db, auth.businessId, data, id);
        await db.transaction(async (tx) => {
          const t = tx as unknown as typeof db;
          await updateItem(t, auth.businessId, id, data);
          const after = (await getItem(t, auth.businessId, id))!;
          const b = snapshotItem(before);
          const a = snapshotItem(after);
          await writeAudit(t, auth, {
            entityType: "item",
            entityId: id,
            action: "update",
            summary: after.name,
            changes: { before: b, after: a, priceChanged: pricesChanged(b, a) },
          });
        });
      } catch (error) {
        if (error instanceof RefError) throw new AppError("validation", { fields: error.fields });
        if (duplicateKey(error)) throw new AppError("conflict", { fields: { variants: (duplicateKey(error) ?? "").includes("barcode") ? "catalog.barcodeDuplicate" : "catalog.skuDuplicate" } });
        throw error;
      }
      return c.json(present((await getItem(db, auth.businessId, id))!));
    },
  );

  app.delete("/:id", requirePrivilege("library.manage"), validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const auth = c.get("auth");
    const before = await getItem(db, auth.businessId, id);
    if (!before) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      const t = tx as unknown as typeof db;
      await softDeleteItem(t, auth.businessId, id);
      await writeAudit(t, auth, { entityType: "item", entityId: id, action: "delete", summary: before.name, changes: { before: snapshotItem(before) } });
    });
    return c.body(null, 204);
  });

  return app;
};

export { toCsv };
