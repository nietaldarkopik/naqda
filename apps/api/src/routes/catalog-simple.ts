import { z } from "zod";
import {
  brands,
  categories,
  discountOutlets,
  discounts,
  gratuities,
  gratuityOutlets,
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
      customizable: z.boolean().default(false),
      status: status.default("active"),
      outletIds: ids.default([]),
    }),
    // Diskon persen disimpan dalam basis point; 100% = 10000.
    check: (d) => (d.kind === "percent" && Number(d.value) > 10_000 ? { value: "errors.validation" } : null),
    links: [outletLink(discountOutlets, "discountId")],
    outletField: "outletIds",
    fields: ["kind", "value", "customizable", "status"],
  });
