/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { brands, bundles, categories, items, modifierSets, newId, promos, salesTypes, translations, type DbHandle } from "@naqdi/db";
import { locales } from "@naqdi/i18n";
import { AppError } from "../errors";
import { requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { missingIn } from "../repo/generic";

type Db = DbHandle["db"];

/** Entitas yang boleh diterjemahkan, tabel asalnya, dan bidang yang diizinkan. */
const entities: Record<string, { table: any; fields: readonly string[] }> = {
  item: { table: items, fields: ["name", "description"] },
  category: { table: categories, fields: ["name"] },
  brand: { table: brands, fields: ["name"] },
  modifier_set: { table: modifierSets, fields: ["name"] },
  bundle: { table: bundles, fields: ["name"] },
  promo: { table: promos, fields: ["name"] },
  sales_type: { table: salesTypes, fields: ["name"] },
};

const entityType = z.enum(Object.keys(entities) as [string, ...string[]]);
const uuid = z.string().uuid();
const localeEnum = z.enum(locales);

const putBody = z.object({
  // { en: { name: "Coffee" }, ar: { name: "قهوة" } }; teks kosong menghapus terjemahan itu.
  translations: z.partialRecord(localeEnum, z.record(z.string().max(32), z.string().trim().max(500))),
});

type Grouped = Record<string, Record<string, string>>;

const group = (rows: Array<{ locale: string; field: string; value: string }>): Grouped => {
  const out: Grouped = {};
  for (const r of rows) (out[r.locale] ??= {})[r.field] = r.value;
  return out;
};

export const translationRoutes = () => {
  const app = new Hono<AppEnv>();

  // Semua terjemahan satu bahasa untuk satu jenis entitas (dipakai kasir untuk menampilkan nama).
  app.get(
    "/",
    requirePrivilege("backoffice.view"),
    validate("query", z.object({ entityType, locale: localeEnum })),
    async (c) => {
      const { entityType: type, locale } = c.req.valid("query");
      const rows = await c
        .get("db")
        .select()
        .from(translations)
        .where(and(eq(translations.businessId, c.get("auth").businessId), eq(translations.entityType, type), eq(translations.locale, locale)));
      return c.json({ items: rows.map((r) => ({ entityId: r.entityId, field: r.field, value: r.value })) });
    },
  );

  app.get("/:entityType/:entityId", requirePrivilege("backoffice.view"), validate("param", z.object({ entityType, entityId: uuid })), async (c) => {
    const { entityType: type, entityId } = c.req.valid("param");
    const db = c.get("db");
    const bid = c.get("auth").businessId;
    if ((await missingIn(db, entities[type]!.table, bid, [entityId])).length) throw new AppError("not_found");
    const rows = await db
      .select()
      .from(translations)
      .where(and(eq(translations.businessId, bid), eq(translations.entityType, type), eq(translations.entityId, entityId)));
    return c.json({ translations: group(rows) });
  });

  app.put(
    "/:entityType/:entityId",
    requirePrivilege("library.manage"),
    validate("param", z.object({ entityType, entityId: uuid })),
    validate("json", putBody),
    async (c) => {
      const { entityType: type, entityId } = c.req.valid("param");
      const { translations: input } = c.req.valid("json");
      const db = c.get("db");
      const auth = c.get("auth");
      const spec = entities[type]!;
      if ((await missingIn(db, spec.table, auth.businessId, [entityId])).length) throw new AppError("not_found");

      const fields: Record<string, string> = {};
      for (const [locale, byField] of Object.entries(input)) {
        for (const field of Object.keys(byField)) {
          if (!spec.fields.includes(field)) fields[`${locale}.${field}`] = "errors.validation";
        }
      }
      if (Object.keys(fields).length) throw new AppError("validation", { fields });

      // Keterangan audit memakai nama dasar entitas, bukan jenisnya.
      const [named] = (await db.select({ name: spec.table.name }).from(spec.table).where(eq(spec.table.id, entityId)).limit(1)) as Array<{ name: string }>;

      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const before = await t
          .select()
          .from(translations)
          .where(and(eq(translations.businessId, auth.businessId), eq(translations.entityType, type), eq(translations.entityId, entityId)));
        for (const [locale, byField] of Object.entries(input)) {
          for (const [field, value] of Object.entries(byField)) {
            const existing = before.find((r) => r.locale === locale && r.field === field);
            if (value === "") {
              if (existing) await t.delete(translations).where(eq(translations.id, existing.id));
            } else if (existing) {
              await t.update(translations).set({ value, updatedAt: new Date() }).where(eq(translations.id, existing.id));
            } else {
              await t.insert(translations).values({ id: newId(), businessId: auth.businessId, entityType: type, entityId, locale, field, value });
            }
          }
        }
        const after = await t
          .select()
          .from(translations)
          .where(and(eq(translations.businessId, auth.businessId), eq(translations.entityType, type), eq(translations.entityId, entityId)));
        await writeAudit(t, auth, { entityType: "translation", entityId, action: "update", summary: named?.name ?? type, changes: { entity: type, before: group(before), after: group(after) } });
      });

      const rows = await db
        .select()
        .from(translations)
        .where(and(eq(translations.businessId, auth.businessId), eq(translations.entityType, type), eq(translations.entityId, entityId)));
      return c.json({ translations: group(rows) });
    },
  );

  return app;
};

export { inArray };
