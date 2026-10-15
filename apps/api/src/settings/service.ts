import { randomBytes } from "node:crypto";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { businesses, businessSettings, paymentMethods, users, type DbHandle } from "@naqdi/db";
import { limitsOf } from "@naqdi/domain";

type Db = DbHandle["db"];

export const checkoutSchema = z.object({
  /** Mati: pajak tidak dihitung di semua outlet (mis. usaha yang belum PKP). */
  taxEnabled: z.boolean().default(true),
  gratuityEnabled: z.boolean().default(true),
  allowSplitPayment: z.boolean().default(true),
});

export const receiptSchema = z.object({
  headerText: z.string().max(200).default(""),
  /** Nomor pajak/registrasi usaha di struk (NPWP, VAT No., TRN, dst.). Kosong = tidak dicetak. Nama bidangnya mengikuti negara. */
  taxId: z.string().trim().max(40).default(""),
  /** Judul untuk nomor itu, mis. "NPWP" atau "VAT No."; kosong memakai "Nomor pajak" sesuai bahasa. */
  taxIdLabel: z.string().trim().max(30).default(""),
  showOutletName: z.boolean().default(true),
  showOutletAddress: z.boolean().default(true),
  showOutletPhone: z.boolean().default(true),
  website: z.string().trim().max(120).default(""),
  instagram: z.string().trim().max(60).default(""),
  /** null = teks bawaan sesuai bahasa; "" = tanpa catatan kaki. */
  footerText: z.string().max(300).nullable().default(null),
  showCashier: z.boolean().default(true),
  showTable: z.boolean().default(true),
  showCustomer: z.boolean().default(true),
  showTaxBreakdown: z.boolean().default(true),
  paperMm: z.union([z.literal(58), z.literal(80)]).default(80),
});

export const notificationsSchema = z.object({
  dailySummary: z.boolean().default(false),
  lowStock: z.boolean().default(false),
  recipients: z.array(z.string().trim().toLowerCase().email()).max(10).default([]),
});

export const accountSchema = z.object({
  /** Batas karyawan aktif; null = tanpa batas. */
  employeeSlots: z.number().int().min(1).max(100_000).nullable().default(null),
  /** Kebijakan retensi: pelanggan tanpa aktivitas selama sekian bulan layak dihapus datanya; null = belum ditetapkan. */
  customerRetentionMonths: z.number().int().min(1).max(240).nullable().default(null),
});

export const sections = { checkout: checkoutSchema, receipt: receiptSchema, notifications: notificationsSchema, account: accountSchema } as const;
export type SectionName = keyof typeof sections;

export type Settings = {
  checkout: z.infer<typeof checkoutSchema>;
  receipt: z.infer<typeof receiptSchema>;
  notifications: z.infer<typeof notificationsSchema>;
  account: z.infer<typeof accountSchema>;
};

/** Pengaturan bisnis dengan nilai bawaan untuk bagian yang belum pernah disimpan atau bidang yang baru ditambahkan. */
export const getSettings = async (db: Db, businessId: string): Promise<Settings> => {
  const [row] = await db.select().from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1);
  const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
    const r = schema.safeParse(value ?? {});
    return r.success ? r.data : schema.parse({});
  };
  return {
    checkout: parse(checkoutSchema, row?.checkout),
    receipt: parse(receiptSchema, row?.receipt),
    notifications: parse(notificationsSchema, row?.notifications),
    account: parse(accountSchema, row?.account),
  };
};

export const saveSection = async (db: Db, businessId: string, userId: string, section: SectionName, data: Record<string, unknown>): Promise<void> => {
  const existing = await db.select({ id: businessSettings.businessId }).from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1);
  if (existing.length) await db.update(businessSettings).set({ [section]: data, updatedBy: userId }).where(eq(businessSettings.businessId, businessId));
  else await db.insert(businessSettings).values({ businessId, [section]: data, updatedBy: userId });
};

// ------------------------------------------------------------------ metode pembayaran

export const systemMethodKeys = ["cash", "card", "qris", "ewallet", "transfer"] as const;
export type MethodRow = typeof paymentMethods.$inferSelect;

/** Membuat lima metode bawaan bila belum ada (aman dipanggil berulang dan bersamaan). */
export const ensurePaymentMethods = async (db: Db, businessId: string): Promise<void> => {
  await db
    .insert(paymentMethods)
    .ignore()
    .values(systemMethodKeys.map((key, position) => ({ businessId, key, isSystem: true, enabled: true, position })));
};

export const listPaymentMethods = async (db: Db, businessId: string): Promise<MethodRow[]> => {
  await ensurePaymentMethods(db, businessId);
  return db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.businessId, businessId), isNull(paymentMethods.deletedAt)))
    .orderBy(asc(paymentMethods.position), asc(paymentMethods.createdAt));
};

/** Metode yang aktif dan boleh dipakai di outlet ini. */
export const enabledMethodsFor = async (db: Db, businessId: string, outletId: string): Promise<MethodRow[]> =>
  (await listPaymentMethods(db, businessId)).filter((m) => m.enabled && (!m.outletIds || m.outletIds.length === 0 || m.outletIds.includes(outletId)));

export const newMethodKey = (): string => `c_${randomBytes(5).toString("hex")}`;

// ------------------------------------------------------------------ slot karyawan

/** Karyawan yang memakai slot: belum dihapus dan tidak dinonaktifkan. */
export const activeEmployeeCount = async (db: Db, businessId: string, excludeUserId?: string): Promise<number> =>
  (
    await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.businessId, businessId), isNull(users.deletedAt), ne(users.status, "inactive"), excludeUserId ? ne(users.id, excludeUserId) : undefined))
  )[0]?.n ?? 0;

export const slotsAvailable = async (db: Db, businessId: string, excludeUserId?: string): Promise<boolean> => {
  const { account } = await getSettings(db, businessId);
  const [b] = await db.select({ plan: businesses.plan, limits: businesses.limits }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  // Batas yang berlaku = yang lebih kecil antara pilihan pemilik (slot) dan batas paket.
  const cap = Math.min(account.employeeSlots ?? Number.MAX_SAFE_INTEGER, b ? limitsOf(b.plan, b.limits).maxEmployees : Number.MAX_SAFE_INTEGER);
  return (await activeEmployeeCount(db, businessId, excludeUserId)) < cap;
};
