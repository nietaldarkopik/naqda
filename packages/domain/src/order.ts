import type { Minor } from "./money";
import { roundTo } from "./money";
import { allocateByRates, mulDivRound } from "./tax";

/**
 * Mesin hitung total pesanan. Murni (tanpa DB/UI), dipakai server dan kasir offline dengan kode yang sama.
 *
 * Urutan (aturan bawaan, bisa diatur per outlet; WAJIB dikonfirmasi dengan akuntan/toko sebelum dipakai sungguhan):
 *   1. Harga baris = harga satuan x jumlah.
 *   2. Diskon baris (persen/nominal), lalu diskon promo otomatis, lalu diskon pesanan.  =>  B (harga setelah diskon)
 *   3. Dari B diturunkan N (nilai barang sebelum pajak dan service charge), service charge G = g x N,
 *      pajak barang = t x N, dan pajak atas service charge = t x G (bila `taxOnGratuity`).
 *   4. Komponen yang "sudah termasuk" di harga menu dipisahkan dari B; yang tidak termasuk ditambahkan di atas B.
 *   5. Pembulatan akhir ke kelipatan `roundingStep`, dicatat terpisah sebagai `rounding`.
 *
 * Semua dalam integer satuan terkecil mata uang; persen dalam basis point (10% = 1000).
 */

export type DiscountInput = { kind: "percent"; bp: number } | { kind: "amount"; amount: Minor };

export interface OrderSettings {
  /** Harga menu sudah termasuk pajak (pajak dipisahkan dari harga). */
  pricesIncludeTax: boolean;
  /** Harga menu sudah termasuk service charge/gratuity. */
  pricesIncludeGratuity: boolean;
  /** Pajak juga dikenakan atas service charge. */
  taxOnGratuity: boolean;
  /** Kelipatan pembulatan total (satuan terkecil); 0 = tanpa pembulatan. Mis. rupiah: 100. */
  roundingStep: number;
  roundingMode: "nearest" | "up" | "down";
}

export const defaultOrderSettings: OrderSettings = {
  pricesIncludeTax: false,
  pricesIncludeGratuity: false,
  taxOnGratuity: true,
  roundingStep: 0,
  roundingMode: "nearest",
};

export interface OrderLineInput {
  id: string;
  /** Harga satuan, sudah termasuk modifier yang dipilih. */
  unitPrice: Minor;
  quantity: number;
  discount?: DiscountInput | null | undefined;
  /** Diskon promo otomatis untuk baris ini (hasil `applyPromos`). Dibatasi sampai sisa harga baris. */
  promoDiscount?: Minor | undefined;
}

export interface OrderInput {
  lines: readonly OrderLineInput[];
  orderDiscount?: DiscountInput | null | undefined;
  /** Tarif pajak (basis point), semuanya berlaku untuk seluruh baris. */
  taxRatesBp: readonly number[];
  gratuityRatesBp: readonly number[];
  settings: OrderSettings;
}

export interface OrderLineResult {
  id: string;
  gross: Minor;
  discount: Minor;
  promoDiscount: Minor;
  /** gross - diskon baris - promo (sebelum diskon pesanan). */
  afterDiscount: Minor;
}

export interface OrderTotals {
  lines: OrderLineResult[];
  subtotal: Minor;
  lineDiscountTotal: Minor;
  promoDiscountTotal: Minor;
  orderDiscount: Minor;
  discountTotal: Minor;
  /** Harga setelah semua diskon (B). */
  base: Minor;
  /** Nilai barang sebelum pajak dan service charge (N). */
  net: Minor;
  gratuity: Minor;
  gratuityPerRate: Minor[];
  /** Pajak atas barang + pajak atas service charge. */
  tax: Minor;
  taxOnGoods: Minor;
  taxOnGratuity: Minor;
  taxPerRate: Minor[];
  /** Bagian dari total yang ditambahkan DI ATAS harga menu (0 bila semuanya sudah termasuk). */
  addedOnTop: Minor;
  totalBeforeRounding: Minor;
  rounding: Minor;
  /** Yang harus dibayar pelanggan. */
  total: Minor;
}

const assertMoney = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} harus integer >= 0`);
};
const assertRates = (rates: readonly number[], label: string) => {
  for (const r of rates) if (!Number.isInteger(r) || r < 0 || r > 10_000) throw new RangeError(`${label} harus 0-10000 basis point`);
};

/** Besar diskon dari `base`; tidak pernah melebihi `base`. */
export const discountAmount = (base: Minor, d: DiscountInput | null | undefined): Minor => {
  if (!d) return 0;
  if (d.kind === "percent") {
    if (!Number.isInteger(d.bp) || d.bp < 0 || d.bp > 10_000) throw new RangeError("diskon persen harus 0-10000 basis point");
    return mulDivRound(base, d.bp, 10_000);
  }
  assertMoney(d.amount, "diskon nominal");
  return Math.min(d.amount, base);
};

const E8 = 100_000_000;

export const computeOrder = (input: OrderInput): OrderTotals => {
  const { settings: s } = input;
  assertRates(input.taxRatesBp, "tarif pajak");
  assertRates(input.gratuityRatesBp, "tarif gratuity");
  if (!Number.isInteger(s.roundingStep) || s.roundingStep < 0) throw new RangeError("roundingStep harus integer >= 0");

  // 1-2. Baris dan diskon
  const lines: OrderLineResult[] = input.lines.map((l) => {
    assertMoney(l.unitPrice, "harga satuan");
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError("jumlah harus integer >= 1");
    const gross = l.unitPrice * l.quantity;
    const discount = discountAmount(gross, l.discount);
    const room = gross - discount;
    const promoDiscount = Math.min(Math.max(l.promoDiscount ?? 0, 0), room);
    assertMoney(promoDiscount, "diskon promo");
    return { id: l.id, gross, discount, promoDiscount, afterDiscount: room - promoDiscount };
  });

  const subtotal = lines.reduce((a, l) => a + l.gross, 0);
  const lineDiscountTotal = lines.reduce((a, l) => a + l.discount, 0);
  const promoDiscountTotal = lines.reduce((a, l) => a + l.promoDiscount, 0);
  const afterLines = subtotal - lineDiscountTotal - promoDiscountTotal;
  const orderDiscount = discountAmount(afterLines, input.orderDiscount);
  const discountTotal = lineDiscountTotal + promoDiscountTotal + orderDiscount;
  const base = afterLines - orderDiscount;

  // 3-4. Turunkan N dari B menurut komponen yang termasuk dalam harga menu.
  const t = input.taxRatesBp.reduce((a, b) => a + b, 0);
  const g = input.gratuityRatesBp.reduce((a, b) => a + b, 0);
  const incT = s.pricesIncludeTax;
  const incG = s.pricesIncludeGratuity;
  const tOnG = s.taxOnGratuity;
  const bothIncluded = incT && incG;

  // B = N x (1 + [incT]t + [incG]g + [incT&&incG&&tOnG] t g), dengan t dan g sebagai pecahan.
  const denominator = E8 + (incT ? t * 10_000 : 0) + (incG ? g * 10_000 : 0) + (bothIncluded && tOnG ? t * g : 0);
  const net = mulDivRound(base, E8, denominator);
  const gratuity = mulDivRound(net, g, 10_000);
  let taxOnGoods = mulDivRound(net, t, 10_000);
  const taxOnGratuity = tOnG ? mulDivRound(gratuity, t, 10_000) : 0;

  // Bagian yang tertanam di B harus tepat B - N; selisih pembulatan (maks. beberapa satuan) diserap pajak barang
  // (atau gratuity bila pajak tidak tertanam) agar total tetap konsisten.
  const embedded = (incT ? taxOnGoods : 0) + (incG ? gratuity : 0) + (bothIncluded ? taxOnGratuity : 0);
  const drift = base - net - embedded;
  let gratuityFinal = gratuity;
  if (drift !== 0) {
    // Dibebankan ke komponen tertanam yang benar-benar ada (tarifnya > 0) dan tetap tidak negatif.
    if (incT && t > 0 && taxOnGoods + drift >= 0) taxOnGoods += drift;
    else if (incG && g > 0 && gratuityFinal + drift >= 0) gratuityFinal += drift;
    else throw new RangeError("selisih pembulatan tidak dapat dialokasikan; periksa tarif dan pengaturan");
  }

  const tax = taxOnGoods + taxOnGratuity;
  const addedOnTop = (incG ? 0 : gratuityFinal) + (incT ? 0 : taxOnGoods) + (bothIncluded ? 0 : taxOnGratuity);
  const totalBeforeRounding = net + gratuityFinal + tax;

  // 5. Pembulatan
  let total = totalBeforeRounding;
  if (s.roundingStep > 0) {
    if (s.roundingMode === "nearest") total = roundTo(totalBeforeRounding, s.roundingStep);
    else if (s.roundingMode === "up") total = Math.ceil(totalBeforeRounding / s.roundingStep) * s.roundingStep;
    else total = Math.floor(totalBeforeRounding / s.roundingStep) * s.roundingStep;
  }

  return {
    lines,
    subtotal,
    lineDiscountTotal,
    promoDiscountTotal,
    orderDiscount,
    discountTotal,
    base,
    net,
    gratuity: gratuityFinal,
    gratuityPerRate: allocateByRates(gratuityFinal, input.gratuityRatesBp),
    tax,
    taxOnGoods,
    taxOnGratuity,
    taxPerRate: allocateByRates(tax, input.taxRatesBp),
    addedOnTop,
    totalBeforeRounding,
    rounding: total - totalBeforeRounding,
    total,
  };
};
