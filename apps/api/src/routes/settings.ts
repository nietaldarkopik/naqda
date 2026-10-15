import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { businesses, emailOutbox, newId, outlets, paymentMethods, type DbHandle } from "@naqdi/db";
import { addDays, currencyInfo, localMoment, supportedCurrencies } from "@naqdi/domain";
import { AppError } from "../errors";
import { iso, patchSchema, requirePrivilege, validate, type AppEnv } from "../http";
import { writeAudit } from "../repo/audit";
import { assignedOutlets } from "../repo/outlet-access";
import { loadDataset } from "../reports/dataset";
import { summarize } from "../reports/engine";
import { moneyDataKinds } from "../settings/currency";
import { getSettings, listPaymentMethods, newMethodKey, saveSection, sections, type SectionName } from "../settings/service";

type Db = DbHandle["db"];
const idParam = z.object({ id: z.string().uuid() });

const presentMethod = (m: typeof paymentMethods.$inferSelect) => ({ id: m.id, key: m.key, name: m.name, isSystem: m.isSystem, enabled: m.enabled, position: m.position, outletIds: m.outletIds ?? [] });

/** Pengaturan akun: checkout, struk, notifikasi, slot karyawan, dan metode pembayaran. Hak: settings.manage. */
export const settingsRoutes = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("settings.manage"));

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const [settings, methods] = await Promise.all([getSettings(db, auth.businessId), listPaymentMethods(db, auth.businessId)]);
    return c.json({ ...settings, paymentMethods: methods.map(presentMethod) });
  });

  // ---------------------------------------------------------------- metode pembayaran
  const methodBody = z.object({
    name: z.string().trim().min(1).max(80).nullable(),
    enabled: z.boolean(),
    position: z.number().int().min(0).max(1000),
    outletIds: z.array(z.string().uuid()).max(500),
  });

  const checkOutlets = async (c: { get: (k: "repo") => AppEnv["Variables"]["repo"] }, ids: string[] | undefined) => {
    if (ids && ids.length && (await c.get("repo").outlets.missing(ids)).length) throw new AppError("validation", { fields: { outletIds: "errors.notFound" } });
  };

  app.post("/payment-methods", validate("json", z.object({ name: z.string().trim().min(1).max(80), outletIds: z.array(z.string().uuid()).max(500).default([]) })), async (c) => {
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    await checkOutlets(c, b.outletIds);
    const all = await listPaymentMethods(db, auth.businessId);
    if (all.some((m) => (m.name ?? "").toLowerCase() === b.name.toLowerCase())) throw new AppError("conflict", { fields: { name: "errors.duplicateName" } });
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(paymentMethods).values({ id, businessId: auth.businessId, key: newMethodKey(), name: b.name, isSystem: false, enabled: true, position: all.length, outletIds: b.outletIds.length ? b.outletIds : null });
      await writeAudit(tx as unknown as Db, auth, { entityType: "payment_method", entityId: id, action: "create", summary: b.name });
    });
    const [row] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1);
    return c.json(presentMethod(row!), 201);
  });

  app.patch("/payment-methods/:id", validate("param", idParam), validate("json", patchSchema(methodBody)), async (c) => {
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(paymentMethods).where(and(eq(paymentMethods.id, id), eq(paymentMethods.businessId, auth.businessId), isNull(paymentMethods.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    if (before.key === "cash" && b.enabled === false) throw new AppError("validation", { fields: { enabled: "settings.cashRequired" } });
    await checkOutlets(c, b.outletIds);
    const set: Partial<typeof paymentMethods.$inferInsert> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.enabled !== undefined) set.enabled = b.enabled;
    if (b.position !== undefined) set.position = b.position;
    if (b.outletIds !== undefined) set.outletIds = b.outletIds.length ? b.outletIds : null;
    await db.transaction(async (tx) => {
      if (Object.keys(set).length) await tx.update(paymentMethods).set(set).where(eq(paymentMethods.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "payment_method", entityId: id, action: "update", summary: before.name ?? before.key, changes: { after: b } });
    });
    const [row] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1);
    return c.json(presentMethod(row!));
  });

  // Hanya metode kustom yang bisa dihapus; transaksi lama tetap menyimpan kuncinya.
  app.delete("/payment-methods/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [before] = await db.select().from(paymentMethods).where(and(eq(paymentMethods.id, id), eq(paymentMethods.businessId, auth.businessId), isNull(paymentMethods.deletedAt))).limit(1);
    if (!before) throw new AppError("not_found");
    if (before.isSystem) throw new AppError("conflict", { messageKey: "settings.systemMethod" });
    await db.transaction(async (tx) => {
      await tx.update(paymentMethods).set({ deletedAt: new Date(), enabled: false }).where(eq(paymentMethods.id, id));
      await writeAudit(tx as unknown as Db, auth, { entityType: "payment_method", entityId: id, action: "delete", summary: before.name ?? before.key });
    });
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- email: ringkasan contoh
  // Belum ada penyedia email: pesan dicatat di email_outbox (status "logged"), tidak dikirim.
  app.post("/notifications/test", async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const s = await getSettings(db, auth.businessId);
    if (s.notifications.recipients.length === 0) throw new AppError("validation", { fields: { recipients: "settings.noRecipients" } });
    const mine = await assignedOutlets(db, auth);
    const tz = mine[0]?.timezone ?? "UTC";
    const day = addDays(localMoment(new Date(), tz).date, -1);
    const ds = await loadDataset(db, { businessId: auth.businessId, outlets: mine, from: day, to: day });
    const m = summarize(ds);
    const [biz] = await db.select({ name: outlets.name }).from(outlets).where(eq(outlets.businessId, auth.businessId)).limit(1);
    const subject = `Ringkasan penjualan ${day}`;
    const body = [
      subject + (biz ? ` (${mine.length} outlet)` : ""),
      `Transaksi: ${m.orders}`,
      `Penjualan kotor: ${m.grossSales}`,
      `Diskon: ${m.discounts}`,
      `Refund: ${m.refundsTotal}`,
      `Penjualan bersih: ${m.netSales}`,
      `Total diterima: ${m.totalCollected}`,
      "(angka dalam satuan terkecil mata uang)",
    ].join("\n");
    await db.insert(emailOutbox).values(s.notifications.recipients.map((to) => ({ id: newId(), businessId: auth.businessId, recipient: to, kind: "daily_summary", subject, body })));
    return c.json({ subject, body, recipients: s.notifications.recipients, delivered: false });
  });

  // ---------------------------------------------------------------- mata uang bisnis
  // Hanya boleh diganti selama belum ada data bernilai uang (lihat moneyDataKinds); jumlah desimal mengikuti kode ISO.
  app.get("/currency", async (c) => {
    const { businessId } = c.get("auth");
    const db = c.get("db");
    const [b] = await db.select({ currency: businesses.currency, exponent: businesses.currencyExponent }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    const reasons = await moneyDataKinds(db, businessId);
    return c.json({ currency: b?.currency ?? "IDR", exponent: b?.exponent ?? 0, locked: reasons.length > 0, reasons, supported: supportedCurrencies });
  });

  app.put("/currency", validate("json", z.object({ currency: z.string().trim().length(3).transform((v) => v.toUpperCase()) })), async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const { currency } = c.req.valid("json");
    const info = currencyInfo(currency);
    if (!info) throw new AppError("validation", { fields: { currency: "settings.currencyUnsupported" } });
    const [before] = await db.select({ currency: businesses.currency }).from(businesses).where(eq(businesses.id, auth.businessId)).limit(1);
    if (before?.currency !== info.code) {
      const reasons = await moneyDataKinds(db, auth.businessId);
      if (reasons.length > 0) throw new AppError("conflict", { messageKey: "settings.currencyLocked", extra: { reasons } });
      await db.transaction(async (tx) => {
        await tx.update(businesses).set({ currency: info.code, currencyExponent: info.exponent }).where(eq(businesses.id, auth.businessId));
        await writeAudit(tx as unknown as Db, auth, { entityType: "settings", entityId: null, action: "update", summary: "currency", changes: { before: before?.currency, after: info.code, exponent: info.exponent } });
      });
    }
    return c.json({ currency: info.code, exponent: info.exponent });
  });

  // ---------------------------------------------------------------- bagian pengaturan (checkout, receipt, notifications, account)
  app.put("/:section", validate("param", z.object({ section: z.enum(["checkout", "receipt", "notifications", "account"]) })), async (c) => {
    const section = c.req.valid("param").section as SectionName;
    const auth = c.get("auth");
    const db = c.get("db");
    const parsed = sections[section].safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join(".") || "_"] ??= i.message;
      throw new AppError("validation", { fields });
    }
    await db.transaction(async (tx) => {
      await saveSection(tx as unknown as Db, auth.businessId, auth.userId, section, parsed.data as Record<string, unknown>);
      await writeAudit(tx as unknown as Db, auth, { entityType: "settings", entityId: null, action: "update", summary: section, changes: { after: parsed.data } });
    });
    return c.json({ ...(await getSettings(db, auth.businessId))[section], updatedAt: iso(new Date()) });
  });

  return app;
};
