import { z } from "zod";
import {
  brands,
  categories,
  discountCategories,
  discountItems,
  discountOutlets,
  discounts,
  gratuities,
  gratuityOutlets,
  items,
  outlets,
  salesTypeGratuities,
  salesTypes,
  taxes,
  taxOutlets,
} from "@naqdi/db";
import { simpleRoutes } from "./simple";

const name = z.string().trim().min(1).max(191);
const ids = z.array(z.string().uuid()).max(500);
const rateBp = z.number().int().min(0).max(10_000);
const status = z.enum(["active", "inactive"]);

const outletLink = (table: unknown, ownerCol: string) => ({
  field: "outletIds",
  table,
  ownerCol,
  otherCol: "outletId",
  target: outlets,
});

export const categoryRoutes = () =>
  simpleRoutes({ entity: "category", table: categories, schema: z.object({ name }), fields: [] });

export const brandRoutes = () =>
  simpleRoutes({ entity: "brand", table: brands, schema: z.object({ name }), fields: [] });

export const salesTypeRoutes = () =>
  simpleRoutes({
    entity: "sales_type",
    table: salesTypes,
    schema: z.object({ name, status: status.default("active"), gratuityIds: ids.default([]) }),
    links: [{ field: "gratuityIds", table: salesTypeGratuities, ownerCol: "salesTypeId", otherCol: "gratuityId", target: gratuities }],
    fields: ["status"],
  });

export const taxRoutes = () =>
  simpleRoutes({
    entity: "tax",
    table: taxes,
    schema: z.object({ name, rateBp, outletIds: ids.default([]) }),
    links: [outletLink(taxOutlets, "taxId")],
    outletField: "outletIds",
    fields: ["rateBp"],
  });

export const gratuityRoutes = () =>
  simpleRoutes({
    entity: "gratuity",
    table: gratuities,
    schema: z.object({ name, rateBp, outletIds: ids.default([]) }),
    links: [outletLink(gratuityOutlets, "gratuityId")],
    outletField: "outletIds",
    fields: ["rateBp"],
  });

export const discountRoutes = () =>
  simpleRoutes({
    entity: "discount",
    table: discounts,
    schema: z.object({
      name,
      kind: z.enum(["percent", "amount"]),
      value: z.number().int().min(0),
      /** order = diskon umum; item = hanya untuk item/kategori yang dipilih. */
      scope: z.enum(["order", "item"]).default("order"),
      customizable: z.boolean().default(false),
      status: status.default("active"),
      outletIds: ids.default([]),
      itemIds: ids.default([]),
      categoryIds: ids.default([]),
    }),
    // Diskon persen disimpan dalam basis point; 100% = 10000.
    check: (d): Record<string, string> | null => {
      if (d.kind === "percent" && Number(d.value) > 10_000) return { value: "errors.validation" };
      // Diskon item wajib punya sasaran; diskon umum tidak boleh membawa sasaran (agar tidak menyesatkan).
      const targets = (Array.isArray(d.itemIds) ? d.itemIds.length : 0) + (Array.isArray(d.categoryIds) ? d.categoryIds.length : 0);
      if (d.scope === "item" && targets === 0) return { itemIds: "discounts.targetRequired" };
      if (d.scope === "order" && targets > 0) return { itemIds: "discounts.targetNotAllowed" };
      return null;
    },
    links: [
      outletLink(discountOutlets, "discountId"),
      { field: "itemIds", table: discountItems, ownerCol: "discountId", otherCol: "itemId", target: items },
      { field: "categoryIds", table: discountCategories, ownerCol: "discountId", otherCol: "categoryId", target: categories },
    ],
    outletField: "outletIds",
    fields: ["kind", "value", "scope", "customizable", "status"],
  });
