import type { Minor } from "./money";
import { mulDivRound } from "./tax";

/**
 * Mesin promo otomatis. Murni; dipakai server dan kasir offline dengan kode yang sama.
 *
 * Aturan (DIDOKUMENTASIKAN agar bisa dikonfirmasi dengan pemilik toko):
 * - Satu unit barang hanya boleh menerima SATU promo. Promo diterapkan berurutan sesuai urutan daftar;
 *   unit yang sudah mendapat promo sebelumnya tidak ikut dihitung sebagai syarat atau penerima promo berikutnya.
 * - Unit diperlakukan satu per satu menurut urutan keranjang, dengan harga satuan baris (termasuk modifier).
 * - `multiple = false`: promo berlaku satu kali. `multiple = true`: berlaku untuk setiap kelipatan syarat.
 * - Diskon per item PERSEN: bila jumlah unit yang memenuhi syarat >= syarat, SEMUA unit itu didiskon ("beli minimal N").
 *   Dengan `multiple`, hanya kelompok penuh (kelipatan syarat) yang didiskon, dalam urutan keranjang.
 * - Diskon per item NOMINAL: potongan tetap sekali (atau per kelipatan bila `multiple`), tidak melebihi harga
 *   unit-unit yang memenuhi syarat.
 * - Beli X gratis Y: unit hadiah yang dipilih adalah yang TERMURAH di antara item hadiah yang ada di keranjang.
 *   Bila item hadiah juga memenuhi syarat (mis. beli 2 gratis 1 untuk item yang sama), unit gratis tidak dihitung
 *   sebagai syarat.
 */

export interface PromoDef {
  id: string;
  type: "item_discount" | "free_item";
  startsAt: Date | null;
  endsAt: Date | null;
  /** "HH:mm" lokal outlet. Bila `from` > `to`, jendela melewati tengah malam. */
  hours: { from: string; to: string } | null;
  /** 0 = Minggu ... 6 = Sabtu, menurut zona waktu outlet. */
  weekdays: readonly number[] | null;
  multiple: boolean;
  requirementScope: "item" | "category";
  requirementItemId: string | null;
  requirementCategoryId: string | null;
  requirementQuantity: number;
  rewardKind: "percent" | "amount" | "free_item";
  /** percent: basis point; amount: satuan terkecil. */
  rewardValue: number;
  rewardItemId: string | null;
  rewardQuantity: number;
  /** Kosong = semua tipe penjualan. */
  salesTypeIds: readonly string[];
}

export interface PromoLine {
  id: string;
  itemId: string;
  categoryId: string | null;
  unitPrice: Minor;
  quantity: number;
}

export interface PromoContext {
  now: Date;
  /** Zona waktu IANA outlet, mis. "Asia/Jakarta". */
  timezone: string;
  salesTypeId: string | null;
}

export interface PromoApplication {
  promoId: string;
  lineId: string;
  amount: Minor;
}

export interface PromoResult {
  /** Total diskon promo per baris (id baris -> jumlah). Hanya baris yang mendapat promo. */
  perLine: Record<string, Minor>;
  applications: PromoApplication[];
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hari dalam minggu dan menit sejak tengah malam pada zona waktu tertentu. */
export const localParts = (date: Date, timezone: string): { weekday: number; minutes: number } => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: WEEKDAYS[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
};

const toMinutes = (hhmm: string): number => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/** Apakah promo berlaku pada waktu dan tipe penjualan ini (status aktif dan outlet diperiksa pemanggil). */
export const isPromoActive = (promo: PromoDef, ctx: PromoContext): boolean => {
  if (promo.startsAt && ctx.now < promo.startsAt) return false;
  if (promo.endsAt && ctx.now > promo.endsAt) return false;
  if (promo.salesTypeIds.length > 0 && (ctx.salesTypeId === null || !promo.salesTypeIds.includes(ctx.salesTypeId))) return false;
  const { weekday, minutes } = localParts(ctx.now, ctx.timezone);
  if (promo.weekdays && promo.weekdays.length > 0 && !promo.weekdays.includes(weekday)) return false;
  if (promo.hours) {
    const from = toMinutes(promo.hours.from);
    const to = toMinutes(promo.hours.to);
    const inside = from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to;
    if (!inside) return false;
  }
  return true;
};

interface Unit {
  lineId: string;
  itemId: string;
  categoryId: string | null;
  price: Minor;
  used: boolean;
}

const qualifies = (promo: PromoDef, u: Unit): boolean =>
  promo.requirementScope === "item" ? u.itemId === promo.requirementItemId : u.categoryId !== null && u.categoryId === promo.requirementCategoryId;

export const applyPromos = (lines: readonly PromoLine[], promos: readonly PromoDef[], ctx: PromoContext): PromoResult => {
  const units: Unit[] = [];
  for (const l of lines) {
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0 || !Number.isInteger(l.quantity) || l.quantity < 1) {
      throw new RangeError("baris promo tidak valid");
    }
    for (let i = 0; i < l.quantity; i++) units.push({ lineId: l.id, itemId: l.itemId, categoryId: l.categoryId, price: l.unitPrice, used: false });
  }

  const applications: PromoApplication[] = [];
  const record = (promoId: string, unit: Unit, amount: Minor) => {
    if (amount <= 0) return;
    unit.used = true;
    applications.push({ promoId, lineId: unit.lineId, amount });
  };

  for (const promo of promos) {
    if (!isPromoActive(promo, ctx) || promo.requirementQuantity < 1) continue;
    const qual = units.filter((u) => !u.used && qualifies(promo, u));

    if (promo.type === "item_discount") {
      const groups = promo.multiple ? Math.floor(qual.length / promo.requirementQuantity) : qual.length >= promo.requirementQuantity ? 1 : 0;
      if (groups === 0) continue;
      // Persen tanpa kelipatan = ambang "beli minimal N": semua unit yang memenuhi syarat. Selain itu hanya kelompok penuh.
      const eligible = promo.rewardKind === "percent" && !promo.multiple ? qual : qual.slice(0, groups * promo.requirementQuantity);
      if (promo.rewardKind === "percent") {
        for (const u of eligible) record(promo.id, u, mulDivRound(u.price, promo.rewardValue, 10_000));
      } else if (promo.rewardKind === "amount") {
        let remaining = groups * promo.rewardValue;
        for (const u of eligible) {
          const take = Math.min(remaining, u.price);
          record(promo.id, u, take);
          remaining -= take;
          if (remaining <= 0) break;
        }
      }
      continue;
    }

    // free_item: cari jumlah kelipatan terbesar yang bisa dipenuhi.
    if (!promo.rewardItemId || promo.rewardQuantity < 1) continue;
    const rewardPool = units.filter((u) => !u.used && u.itemId === promo.rewardItemId).sort((a, b) => a.price - b.price);
    if (rewardPool.length === 0) continue;
    const maxGroups = promo.multiple ? Math.floor(qual.length / promo.requirementQuantity) : 1;
    for (let k = maxGroups; k >= 1; k--) {
      const free = rewardPool.slice(0, Math.min(k * promo.rewardQuantity, rewardPool.length));
      const freeSet = new Set(free);
      const requirementLeft = qual.filter((u) => !freeSet.has(u)).length;
      if (requirementLeft >= k * promo.requirementQuantity) {
        for (const u of free) record(promo.id, u, u.price);
        break;
      }
    }
  }

  const perLine: Record<string, Minor> = {};
  for (const a of applications) perLine[a.lineId] = (perLine[a.lineId] ?? 0) + a.amount;
  return { perLine, applications };
};
