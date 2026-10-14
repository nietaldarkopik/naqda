import type { Minor } from "./money";
import { mulDivRound } from "./tax";

export interface PricedVariant {
  basePrice: Minor;
  /** Harga khusus per sales type (id sales type -> harga). */
  prices: Readonly<Record<string, Minor>>;
}

/** Harga varian untuk sales type tertentu: harga khusus bila ada, selain itu harga dasar. */
export const priceFor = (variant: PricedVariant, salesTypeId: string | null | undefined): Minor => {
  if (salesTypeId && Object.prototype.hasOwnProperty.call(variant.prices, salesTypeId)) {
    return variant.prices[salesTypeId] as Minor;
  }
  return variant.basePrice;
};

/** Basis point ke persen untuk tampilan: 1100 -> 11. */
export const bpToPercent = (bp: number): number => bp / 100;
export const percentToBp = (percent: number): number => Math.round(percent * 100);

/** Persentase dari uang, dibulatkan ke satuan terkecil (setengah ke atas). rateBp: 1000 = 10%. */
export const percentOf = (amount: Minor, rateBp: number): Minor => mulDivRound(amount, rateBp, 10_000);
