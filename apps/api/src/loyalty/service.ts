import { createHash, randomInt } from "node:crypto";
import { and, asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  customers,
  loyaltyCodes,
  loyaltyEarnRules,
  loyaltyLedger,
  loyaltyPrograms,
  loyaltyRedemptions,
  loyaltyRewards,
  newId,
  orderItems,
  outlets,
  smsOutbox,
  type DbHandle,
} from "@naqdi/db";
import { earnFromItems, earnFromSpend, localMoment, reversalPoints, type RewardDef } from "@naqdi/domain";
import { AppError } from "../errors";

type Db = DbHandle["db"];
export type Customer = typeof customers.$inferSelect;
export type Program = typeof loyaltyPrograms.$inferSelect;
export type Reward = typeof loyaltyRewards.$inferSelect;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fail = (key: string, field = "rewardId"): never => {
  throw new AppError("validation", { fields: { [field]: key } });
};
const conflict = (key: string): never => {
  throw new AppError("conflict", { messageKey: key });
};

export const getProgram = async (db: Db, businessId: string): Promise<Program | null> => (await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.businessId, businessId)).limit(1))[0] ?? null;

/** Program aktif pada tanggal setempat tertentu (YYYY-MM-DD). */
export const programActive = (p: Program | null, localDate: string): p is Program =>
  Boolean(p && p.enabled && (!p.validFrom || localDate >= p.validFrom) && (!p.validTo || localDate <= p.validTo));

export const rewardDef = (r: Reward): RewardDef => ({ kind: r.kind, valueKind: r.valueKind, value: r.value, maxDiscount: r.maxDiscount, minPurchase: r.minPurchase, itemId: r.itemId, categoryId: r.categoryId });

export const findCustomer = async (db: Db, businessId: string, id: string, forUpdate = false): Promise<Customer | null> => {
  const q = db.select().from(customers).where(and(eq(customers.id, id), eq(customers.businessId, businessId), isNull(customers.deletedAt))).limit(1);
  return (await (forUpdate ? q.for("update") : q))[0] ?? null;
};

/** Menambah/mengurangi poin dan menulis buku besar. Pemanggil sudah mengunci baris pelanggan. */
export const addPoints = async (
  tx: Db,
  customer: Customer,
  kind: "earn" | "redeem" | "bonus" | "adjust" | "reverse",
  points: number,
  info: { orderId?: string | null; rewardId?: string | null; note?: string | null; userId?: string | null } = {},
): Promise<Customer> => {
  const balance = customer.points + points;
  await tx.update(customers).set({ points: balance }).where(eq(customers.id, customer.id));
  await tx.insert(loyaltyLedger).values({
    id: newId(),
    businessId: customer.businessId,
    customerId: customer.id,
    kind,
    points,
    balanceAfter: balance,
    orderId: info.orderId ?? null,
    rewardId: info.rewardId ?? null,
    note: info.note ?? null,
    createdBy: info.userId ?? null,
  });
  return { ...customer, points: balance };
};

export const memberCount = async (db: Db, businessId: string): Promise<number> =>
  (await db.select({ n: count() }).from(customers).where(and(eq(customers.businessId, businessId), isNull(customers.deletedAt), isNotNull(customers.memberSince))))[0]?.n ?? 0;

/** Mendaftarkan pelanggan sebagai member (butuh program aktif dan kuota). Bonus member baru hanya sekali. */
export const enrollCustomer = async (tx: Db, businessId: string, customerId: string, localDate: string, userId: string | null): Promise<Customer> => {
  const c = await findCustomer(tx, businessId, customerId, true);
  if (!c) throw new AppError("not_found");
  if (c.memberSince) return c;
  const program = await getProgram(tx, businessId);
  if (!programActive(program, localDate)) return conflict("loyalty.programOff");
  if (program.memberQuota !== null && (await memberCount(tx, businessId)) >= program.memberQuota) return conflict("loyalty.quotaFull");
  await tx.update(customers).set({ memberSince: new Date() }).where(eq(customers.id, c.id));
  let out: Customer = { ...c, memberSince: new Date() };
  if (!c.bonusGranted && program.bonusNewMember > 0) {
    out = await addPoints(tx, out, "bonus", program.bonusNewMember, { note: "Bonus member baru", userId });
    await tx.update(customers).set({ bonusGranted: true }).where(eq(customers.id, c.id));
  } else if (!c.bonusGranted) await tx.update(customers).set({ bonusGranted: true }).where(eq(customers.id, c.id));
  return out;
};

/** Validasi reward untuk sebuah keranjang: pelanggan member, program aktif, reward aktif, dan poin cukup. */
export const loadRewardContext = async (db: Db, businessId: string, customerId: string, rewardId: string, localDate: string) => {
  const customer = await findCustomer(db, businessId, customerId);
  if (!customer) return fail("errors.notFound", "customerId");
  const program = await getProgram(db, businessId);
  if (!programActive(program, localDate)) return fail("loyalty.programOff");
  if (!customer.memberSince) return fail("loyalty.notMember");
  const [reward] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, rewardId), eq(loyaltyRewards.businessId, businessId), isNull(loyaltyRewards.deletedAt), eq(loyaltyRewards.status, "active"))).limit(1);
  if (!reward) return fail("errors.notFound");
  if (customer.points < reward.pointsCost) return fail("loyalty.rewardInsufficient");
  return { customer, program, reward };
};

// ------------------------------------------------------------------ kode validasi

/** Kode 6 angka; hanya hash disimpan. Pesan dicatat di sms_outbox (belum ada penyedia SMS, jadi status "logged"). */
export const issueCode = async (db: Db, businessId: string, customer: Customer, reward: Reward, exposeCode: boolean): Promise<{ expiresInSeconds: number; devCode?: string }> => {
  if (!customer.phone) return fail("loyalty.noPhone", "customerId");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const ttl = 10 * 60;
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.insert(loyaltyCodes).values({ id: newId(), businessId, customerId: customer.id, rewardId: reward.id, codeHash: sha(`${customer.id}:${reward.id}:${code}`), expiresAt: new Date(Date.now() + ttl * 1000) });
    await tx.insert(smsOutbox).values({ id: newId(), businessId, customerId: customer.id, phone: customer.phone!, kind: "loyalty_code", body: `Kode penukaran ${reward.name}: ${code}. Berlaku 10 menit. Jangan berikan kepada siapa pun selain kasir.`.slice(0, 500) });
  });
  if (exposeCode) console.log(`[sms:logged] ${customer.phone} kode ${code}`);
  return { expiresInSeconds: ttl, ...(exposeCode ? { devCode: code } : {}) };
};

/** Memeriksa dan memakai kode (di dalam transaksi bayar). Lima kali salah menghanguskan kode terbaru. */
const consumeCode = async (tx: Db, businessId: string, customerId: string, rewardId: string, code: string | null | undefined): Promise<void> => {
  const [latest] = await tx
    .select()
    .from(loyaltyCodes)
    .where(and(eq(loyaltyCodes.businessId, businessId), eq(loyaltyCodes.customerId, customerId), eq(loyaltyCodes.rewardId, rewardId), isNull(loyaltyCodes.usedAt)))
    .orderBy(desc(loyaltyCodes.createdAt))
    .limit(1)
    .for("update");
  if (!latest || latest.expiresAt.getTime() < Date.now()) return conflict("loyalty.codeInvalid");
  if (!code || sha(`${customerId}:${rewardId}:${code.trim()}`) !== latest.codeHash) {
    const attempts = latest.attempts + 1;
    // Percobaan salah harus bertahan walau pembayaran dibatalkan (rollback): pemanggil mencatatnya lewat galat khusus.
    throw new CodeRejected(attempts >= 5 ? "loyalty.codeBlocked" : "loyalty.codeInvalid", latest.id, attempts);
  }
  await tx.update(loyaltyCodes).set({ usedAt: new Date() }).where(eq(loyaltyCodes.id, latest.id));
};

/** Galat khusus agar pemanggil dapat mencatat percobaan salah di luar transaksi yang di-rollback. */
export class CodeRejected extends Error {
  constructor(
    public readonly key: string,
    public readonly codeId: string,
    public readonly attempts: number,
  ) {
    super(key);
  }
}

export const recordCodeAttempt = async (db: Db, e: CodeRejected): Promise<void> => {
  await db.update(loyaltyCodes).set({ attempts: e.attempts, ...(e.attempts >= 5 ? { usedAt: new Date() } : {}) }).where(eq(loyaltyCodes.id, e.codeId));
};

// ------------------------------------------------------------------ saat pembayaran dan refund

interface OrderForLoyalty {
  id: string;
  businessId: string;
  outletId: string;
  customerId: string | null;
  rewardId: string | null;
  net: number;
  total: number;
  discountTotal: number;
  pricingSnapshot: Record<string, unknown> | null;
  paidAt: Date | null;
}

/**
 * Dipanggil di dalam transaksi bayar: menukar reward (memotong poin, mencatat penukaran, memakai kode) lalu memberi poin untuk
 * pesanan ini. Pelanggan non-member hanya menambah total belanja dan kunjungan.
 */
export const settleLoyalty = async (tx: Db, order: OrderForLoyalty, code: string | null | undefined, userId: string): Promise<{ earned: number; redeemed: number }> => {
  if (!order.customerId) return { earned: 0, redeemed: 0 };
  let customer = await findCustomer(tx, order.businessId, order.customerId, true);
  if (!customer) return { earned: 0, redeemed: 0 };
  const [outlet] = await tx.select({ tz: outlets.timezone }).from(outlets).where(eq(outlets.id, order.outletId)).limit(1);
  const localDate = localMoment(order.paidAt ?? new Date(), outlet?.tz ?? "UTC").date;
  const program = await getProgram(tx, order.businessId);
  const active = programActive(program, localDate);

  let redeemed = 0;
  if (order.rewardId) {
    if (!active || !customer.memberSince) return conflict("loyalty.rewardInvalid");
    const [reward] = await tx.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, order.rewardId), eq(loyaltyRewards.businessId, order.businessId), isNull(loyaltyRewards.deletedAt), eq(loyaltyRewards.status, "active"))).limit(1);
    if (!reward) return conflict("loyalty.rewardInvalid");
    if (customer.points < reward.pointsCost) return conflict("loyalty.rewardInsufficient");
    if (program.requireCode) await consumeCode(tx, order.businessId, customer.id, reward.id, code);
    customer = await addPoints(tx, customer, "redeem", -reward.pointsCost, { orderId: order.id, rewardId: reward.id, note: reward.name, userId });
    await tx.insert(loyaltyRedemptions).values({ id: newId(), businessId: order.businessId, customerId: customer.id, rewardId: reward.id, orderId: order.id, points: reward.pointsCost, discount: Number((order.pricingSnapshot?.reward as { discount?: number } | undefined)?.discount ?? 0) });
    redeemed = reward.pointsCost;
  }

  let earned = 0;
  if (active && customer.memberSince) {
    if (program.pointMode === "spend") earned = earnFromSpend(order.net, { amount: program.spendAmount, points: program.spendPoints });
    else {
      const rules = await tx.select().from(loyaltyEarnRules).where(eq(loyaltyEarnRules.businessId, order.businessId));
      const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      earned = earnFromItems(lines.map((l) => ({ itemId: l.itemId, categoryId: l.categoryId, quantity: l.quantity })), rules);
    }
    if (earned > 0) customer = await addPoints(tx, customer, "earn", earned, { orderId: order.id, note: null, userId });
  }
  await tx.update(customers).set({ lifetimeSpending: customer.lifetimeSpending + order.total, visits: customer.visits + 1 }).where(eq(customers.id, customer.id));
  return { earned, redeemed };
};

/** Refund mengurangi poin yang didapat dari pesanan itu (sebanding) dan total belanja pelanggan. */
export const reverseLoyalty = async (tx: Db, order: { id: string; businessId: string; customerId: string | null; pointsEarned: number; total: number; refundedTotal: number }, refundNow: number, userId: string): Promise<void> => {
  if (!order.customerId) return;
  const customer = await findCustomer(tx, order.businessId, order.customerId, true);
  if (!customer) return;
  const pts = reversalPoints(order.pointsEarned, order.total, order.refundedTotal, refundNow);
  let c = customer;
  if (pts > 0) c = await addPoints(tx, c, "reverse", -pts, { orderId: order.id, note: "Refund", userId });
  await tx.update(customers).set({ lifetimeSpending: Math.max(0, c.lifetimeSpending - refundNow) }).where(eq(customers.id, c.id));
};

export const rewardsOf = async (db: Db, businessId: string) =>
  db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.businessId, businessId), isNull(loyaltyRewards.deletedAt))).orderBy(asc(loyaltyRewards.pointsCost));
