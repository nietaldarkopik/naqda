import type { OfflinePrice, OrderSettings, Rates, StoredDiscount } from "@naqdi/domain";

/**
 * Protokol sinkron kasir offline. Satu operasi = satu penjualan langsung (buat bill + bayar sekaligus).
 * `clientId` (UUID) menjadi id order di server, sehingga mengirim ulang operasi yang sama tidak pernah menggandakan order.
 */

export interface SaleQuoteLine {
  itemId: string | null;
  variantId: string | null;
  bundleId: string | null;
  categoryId: string | null;
  promoId: string | null;
  name: string;
  sku: string | null;
  /** Harga satuan termasuk modifier, seperti yang dilihat kasir saat menjual. */
  unitPrice: number;
  basePrice: number;
  quantity: number;
  discount: StoredDiscount | null;
  promoDiscount: number;
  note: string | null;
  modifiers: { optionId: string | null; name: string; price: number }[];
}

export interface SalePayment {
  method: string;
  amount: number;
  reference?: string | null;
}

export interface SaleOp {
  type: "sale";
  clientId: string;
  /** Waktu penjualan menurut jam perangkat (ISO). */
  createdAt: string;
  /** Rujukan struk sementara yang dicetak di perangkat, mis. OFF-260101-0007. */
  clientRef: string;
  userId: string;
  shiftId: string;
  salesTypeId: string;
  label?: string | null;
  note?: string | null;
  lines: SaleQuoteLine[];
  orderDiscount: StoredDiscount | null;
  /** Tarif dan pengaturan yang dipakai perangkat; server menghitung ulang total dari sini dan harus sama dengan `total`. */
  taxes: Rates["taxes"];
  gratuities: Rates["gratuities"];
  settings: OrderSettings;
  total: number;
  payments: SalePayment[];
}

export type SyncStatus = "created" | "duplicate" | "rejected";

export interface SyncResult {
  clientId: string;
  status: SyncStatus;
  orderId?: string;
  receiptNumber?: number | null;
  /** Catatan untuk ditinjau pemilik, mis. "price_mismatch". */
  flags?: string[];
  /** Hanya untuk `rejected`: kode galat dan apakah layak dicoba lagi tanpa mengubah operasi. */
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface BuildSaleInput {
  clientId: string;
  clientRef: string;
  createdAt: Date;
  userId: string;
  shiftId: string;
  salesTypeId: string;
  label?: string | null;
  note?: string | null;
  price: OfflinePrice;
  payments: SalePayment[];
}

/** Menyusun operasi sinkron dari hasil hitung offline. */
export const buildSaleOp = (i: BuildSaleInput): SaleOp => {
  const { lines, priced, rates, orderDiscount } = i.price;
  return {
    type: "sale",
    clientId: i.clientId,
    createdAt: i.createdAt.toISOString(),
    clientRef: i.clientRef,
    userId: i.userId,
    shiftId: i.shiftId,
    salesTypeId: i.salesTypeId,
    label: i.label ?? null,
    note: i.note ?? null,
    lines: lines.map((l, idx) => ({
      itemId: l.itemId,
      variantId: l.variantId,
      bundleId: l.bundleId,
      categoryId: l.categoryId,
      promoId: priced.promoByLine[l.key] ?? null,
      name: l.name,
      sku: l.sku,
      unitPrice: l.unitPrice,
      basePrice: l.basePrice,
      quantity: l.quantity,
      discount: l.discount,
      promoDiscount: priced.totals.lines[idx]?.promoDiscount ?? 0,
      note: l.note,
      modifiers: l.modifiers,
    })),
    orderDiscount,
    taxes: rates.taxes,
    gratuities: rates.gratuities,
    settings: priced.snapshot.settings as OrderSettings,
    total: priced.totals.total,
    payments: i.payments,
  };
};
