import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { businesses, invoiceProofs, invoices, newId, type DbHandle } from "@naqdi/db";
import { billingIntervals, planPricesIdr, selfServePrice, type BillingInterval } from "@naqdi/domain";
import { businessBilling } from "../billing/access";
import { billingView } from "../billing/view";
import { RENEWAL_LEAD_DAYS, activeInvoice, createInvoice, invoiceView, latestProof } from "../billing/invoices";
import type { Config } from "../config";
import { AppError } from "../errors";
import { requirePrivilege, validate, type AppEnv } from "../http";
import { sniffImage } from "../storage";
import { MAX_IMAGE_BYTES } from "./files";

type Db = DbHandle["db"];
const idParam = z.object({ id: z.string().uuid() });

/**
 * Langganan dari sisi pelanggan: lihat status dan faktur, pilih paket, kirim bukti transfer. Hak: settings.manage.
 * Rute ini tetap bisa DITULIS saat bisnis terkunci (lihat pengecualian di enforceBackofficeAccess): pelanggan harus bisa membayar.
 */
export const billingRoutes = (db: Db, config: Config) => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("settings.manage"));

  const load = async (businessId: string) => {
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!biz) throw new AppError("not_found");
    return biz;
  };

  app.get("/", async (c) => {
    const businessId = c.get("auth").businessId;
    const biz = await load(businessId);
    const billing = await businessBilling(db, businessId, 0);

    // Faktur perpanjangan terbit sendiri menjelang akhir periode (siklus yang sama), selama belum ada faktur berjalan.
    let current = await activeInvoice(db, businessId);
    const interval = biz.billingInterval as BillingInterval | null;
    if (!current && biz.status === "active" && interval && billing?.access.daysLeft != null && billing.access.daysLeft <= RENEWAL_LEAD_DAYS) {
      const price = selfServePrice(biz.plan, interval, biz.currency);
      if (price !== null) current = await createInvoice(db, { businessId, plan: biz.plan, interval, amount: price, currency: biz.currency });
    }

    const rows = await db.select().from(invoices).where(eq(invoices.businessId, businessId)).orderBy(desc(invoices.createdAt)).limit(30);
    const withProof = rows.filter((r) => r.status === "pending" || r.id === current?.id);
    const proofs = await Promise.all(withProof.map((r) => latestProof(db, r.id)));
    const proofByInvoice = new Map(withProof.map((r, i) => [r.id, proofs[i] ?? null] as const));
    return c.json({
      billing: await billingView(db, businessId),
      currency: biz.currency,
      plan: biz.plan,
      interval,
      // Daftar harga hanya untuk rupiah; bisnis lain ditagih lewat faktur khusus dari pengelola.
      prices: biz.currency === "IDR" ? (["basic", "pro"] as const).map((p) => ({ plan: p, monthly: planPricesIdr[p].monthly, yearly: planPricesIdr[p].yearly })) : null,
      bankInfo: config.billingBankInfo || null,
      currentInvoiceId: current?.id ?? null,
      invoices: rows.map((r) => invoiceView(r, proofByInvoice.get(r.id) ?? null)),
    });
  });

  app.post("/invoices", validate("json", z.object({ plan: z.enum(["basic", "pro"]), interval: z.enum(billingIntervals) })), async (c) => {
    const businessId = c.get("auth").businessId;
    const { plan, interval } = c.req.valid("json");
    const biz = await load(businessId);
    const price = selfServePrice(plan, interval, biz.currency);
    if (price === null) throw new AppError("validation", { fields: { plan: "billing.noPrice" } });

    const current = await activeInvoice(db, businessId);
    if (current?.status === "pending") throw new AppError("conflict", { messageKey: "billing.invoicePending" });
    // Mengganti pilihan paket: faktur terbuka lama dibatalkan (belum ada bukti), diganti yang baru.
    if (current) await db.update(invoices).set({ status: "void" }).where(eq(invoices.id, current.id));
    const row = await createInvoice(db, { businessId, plan, interval, amount: price, currency: biz.currency });
    return c.json({ invoice: invoiceView(row) }, 201);
  });

  app.post("/invoices/:id/void", validate("param", idParam), async (c) => {
    const businessId = c.get("auth").businessId;
    const { id } = c.req.valid("param");
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv || inv.businessId !== businessId) throw new AppError("not_found");
    if (inv.status !== "open") throw new AppError("conflict", { messageKey: "billing.invoiceNotOpen" });
    await db.update(invoices).set({ status: "void" }).where(eq(invoices.id, id));
    return c.json({ ok: true });
  });

  /** Bukti transfer (multipart): bank, sender, transferredOn (YYYY-MM-DD), note, dan gambar opsional. Faktur menjadi "pending". */
  app.post("/invoices/:id/proof", validate("param", idParam), async (c) => {
    const businessId = c.get("auth").businessId;
    const { id } = c.req.valid("param");
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv || inv.businessId !== businessId) throw new AppError("not_found");
    if (inv.status !== "open") throw new AppError("conflict", { messageKey: "billing.invoiceNotOpen" });

    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES + 64 * 1024) throw new AppError("validation", { fields: { file: "catalog.imageTooLarge" } });
    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw new AppError("validation", { fields: { file: "errors.validation" } });
    }
    const text = (k: string) => (typeof form[k] === "string" ? (form[k] as string).trim() : "");
    const fields: Record<string, string> = {};
    const bank = text("bank");
    const sender = text("sender");
    const transferredOn = text("transferredOn");
    const note = text("note");
    if (bank.length < 2 || bank.length > 80) fields.bank = "common.required";
    if (sender.length < 2 || sender.length > 120) fields.sender = "common.required";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferredOn) || Number.isNaN(Date.parse(`${transferredOn}T00:00:00Z`))) fields.transferredOn = "common.required";
    else if (Date.parse(`${transferredOn}T00:00:00Z`) > Date.now() + 2 * 86_400_000) fields.transferredOn = "billing.dateFuture";
    if (note.length > 255) fields.note = "errors.validation";

    let image: Buffer | null = null;
    let imageType: string | null = null;
    const file = form.file;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) fields.file = "catalog.imageTooLarge";
      else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = sniffImage(bytes);
        if (!type) fields.file = "catalog.imageType";
        else {
          image = Buffer.from(bytes);
          imageType = type.mime;
        }
      }
    }
    if (Object.keys(fields).length) throw new AppError("validation", { fields });

    await db.transaction(async (tx) => {
      await tx.insert(invoiceProofs).values({ id: newId(), invoiceId: id, bank, sender, transferredOn, note: note || null, imageType, image });
      await tx.update(invoices).set({ status: "pending", rejectReason: null }).where(eq(invoices.id, id));
    });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return c.json({ invoice: invoiceView(row!, await latestProof(db, id)) }, 201);
  });

  app.get("/invoices/:id/proof-image", validate("param", idParam), async (c) => {
    const businessId = c.get("auth").businessId;
    const { id } = c.req.valid("param");
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv || inv.businessId !== businessId) throw new AppError("not_found");
    const proof = await latestProof(db, id);
    if (!proof?.image) throw new AppError("not_found");
    return new Response(new Uint8Array(proof.image), {
      headers: { "content-type": proof.imageType ?? "image/jpeg", "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox" },
    });
  });

  return app;
};
