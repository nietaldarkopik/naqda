/**
 * Klien API aplikasi kasir. Dua kredensial berbeda dari Back Office:
 *  - token perangkat (localStorage): mengikat tablet ke satu outlet, bertahan sampai dicabut dari Back Office;
 *  - token sesi kasir (memori saja): didapat dari PIN, hilang saat halaman dimuat ulang atau kasir keluar.
 */

export class PosError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// ---- konektivitas
// `navigator.onLine` menipu (true pada Wi-Fi tanpa internet), jadi status ditentukan dari hasil permintaan sebenarnya:
// gagal menjangkau server = offline; jawaban apa pun (termasuk galat HTTP) = online.
let online = typeof navigator === "undefined" ? true : navigator.onLine;
const onlineListeners = new Set<() => void>();
export const getOnline = (): boolean => online;
export const subscribeOnline = (fn: () => void): (() => void) => {
  onlineListeners.add(fn);
  return () => onlineListeners.delete(fn);
};
export const setOnline = (value: boolean): void => {
  if (value === online) return;
  online = value;
  for (const fn of onlineListeners) fn();
};

const DEVICE_KEY = "naqdi.pos.device";
let sessionToken: string | null = null;
let onDeviceLost: (() => void) | null = null;
let onSessionLost: (() => void) | null = null;

export const getDeviceToken = (): string | null => {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
};
export const setDeviceToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* penyimpanan diblokir: perangkat harus diaktifkan ulang setiap kali */
  }
};
export const setSessionToken = (token: string | null) => {
  sessionToken = token;
  if (!token) clearSavedSession();
};

// ---- pemulihan sesi saat halaman dimuat ulang
// Token sesi tetap di memori sebagai sumber utama. Salinannya disimpan di sessionStorage (hilang saat tab/aplikasi ditutup,
// tidak dibagi antar tab) HANYA agar muat ulang halaman, mis. saat offline, tidak mengeluarkan kasir yang sedang berjualan.
// Dihapus saat keluar, sesi berakhir, atau perangkat dicabut. Kedaluwarsa tetap mengikuti token (12 jam secara bawaan).
const SESSION_KEY = "naqdi.pos.session";

export interface SavedSession {
  session: PosSession;
  shift: ShiftView | null;
}

const tokenExpiry = (token: string): number | null => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

export const saveSession = (session: PosSession, shift: ShiftView | null): void => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ session, shift } satisfies SavedSession));
  } catch {
    /* penyimpanan diblokir: muat ulang akan meminta PIN */
  }
};

export const clearSavedSession = (): void => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* abaikan */
  }
};

/** Sesi tersimpan bila tokennya masih berlaku (sisa > 1 menit); kalau tidak dibuang. */
export const loadSavedSession = (): SavedSession | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSession;
    const exp = tokenExpiry(saved.session.accessToken);
    if (exp === null || exp - Date.now() < 60_000) {
      clearSavedSession();
      return null;
    }
    return saved;
  } catch {
    clearSavedSession();
    return null;
  }
};
export const setPosLostHandlers = (device: (() => void) | null, session: (() => void) | null) => {
  onDeviceLost = device;
  onSessionLost = session;
};

export async function posApi<T>(path: string, init: { method?: string; json?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers = new Headers({ "x-client": "pos", "x-locale": document.documentElement.lang || "id" });
  const device = getDeviceToken();
  if (device) headers.set("x-device-token", device);
  if (init.auth !== false && sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  let body: string | undefined;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`/api/v1/pos${path}`, { method: init.method ?? "GET", headers, body });
  } catch {
    setOnline(false);
    throw new PosError(0, "network", "network");
  }
  setOnline(true);
  if (res.ok) return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  let data: { code?: string; message?: string; fields?: Record<string, string>; extra?: Record<string, unknown> } = {};
  try {
    data = await res.json();
  } catch {
    /* tubuh kosong */
  }
  const err = new PosError(res.status, data.code ?? "server", data.message ?? res.statusText, data.fields, data.extra);
  // 401 pada perangkat = dicabut/tidak dikenal; 401 pada sesi = token kedaluwarsa. Pembedaan lewat ada/tidaknya token sesi.
  if (res.status === 401 && path !== "/devices/activate" && path !== "/auth/pin") {
    if (sessionToken) onSessionLost?.();
    else onDeviceLost?.();
  }
  throw err;
}

// ---- tipe data

export interface PosOutlet {
  id: string;
  name: string;
  timezone: string;
  settings: { pricesIncludeTax: boolean; pricesIncludeGratuity: boolean; taxOnGratuity: boolean; roundingStep: number; roundingMode: string; discountMode: "sequential" | "stack" | "exclusive" };
}
export interface PosBusiness {
  id: string;
  name: string;
  currency: string;
  currencyExponent: number;
  defaultLocale: string;
}
export interface PosUserLite {
  id: string;
  name: string;
  role: { systemKey: string | null; name: string | null };
  locked: boolean;
}
export interface PosSession {
  accessToken: string;
  user: { id: string; name: string; locale: string | null; privileges: string[]; role: { systemKey: string | null; name: string | null } };
  outlet: PosOutlet;
  business: PosBusiness;
}
export interface CatalogVariant {
  id: string;
  name: string;
  sku: string | null;
  basePrice: number;
  prices: Record<string, number>;
  /** Sisa stok outlet ini; null bila item tidak melacak stok. */
  stock: number | null;
}
export interface CatalogModifierSet {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number | null;
  options: { id: string; name: string; price: number }[];
}
export interface CatalogItem {
  id: string;
  name: string;
  categoryId: string | null;
  imageUrl: string | null;
  variants: CatalogVariant[];
  modifierSets: CatalogModifierSet[];
}
export interface CatalogBundle {
  id: string;
  name: string;
  price: number;
  prices: Record<string, number>;
}
export interface PosDiscount {
  id: string;
  name: string;
  kind: "percent" | "amount";
  value: number;
  scope: "order" | "item";
  itemIds: string[];
  categoryIds: string[];
  customizable: boolean;
}
export interface Catalog {
  stockMode: "off" | "block" | "override";
  categories: { id: string; name: string }[];
  salesTypes: { id: string; name: string }[];
  discounts: PosDiscount[];
  items: CatalogItem[];
  bundles: CatalogBundle[];
}

export type DiscountPick = { discountId: string; value?: number };
export type CartLine =
  | { kind: "item"; variantId: string; quantity: number; modifierOptionIds: string[]; note?: string | null; discount?: DiscountPick | null }
  | { kind: "bundle"; bundleId: string; quantity: number; note?: string | null; discount?: DiscountPick | null };
export interface Cart {
  salesTypeId: string;
  tableId?: string | null;
  customerId?: string | null;
  rewardId?: string | null;
  lines: CartLine[];
  orderDiscount?: DiscountPick | null;
  label?: string | null;
  note?: string | null;
}

export interface Totals {
  subtotal: number;
  lineDiscountTotal: number;
  promoDiscountTotal: number;
  orderDiscount: number;
  discountTotal: number;
  base: number;
  net: number;
  gratuity: number;
  tax: number;
  rounding: number;
  total: number;
  lines: { id: string; gross: number; discount: number; promoDiscount: number; afterDiscount: number }[];
}
export interface PricedLine {
  name: string;
  unitPrice: number;
  quantity: number;
  modifiers: { optionId: string | null; name: string; price: number }[];
  gross: number;
  discount: number;
  promoDiscount: number;
  afterDiscount: number;
}
export interface PriceResult {
  totals: Totals;
  lines: PricedLine[];
  snapshot: { taxes: { name: string; rateBp: number; amount: number }[]; gratuities: { name: string; rateBp: number; amount: number }[] };
}

export interface OrderLineView {
  id: string;
  itemId: string | null;
  variantId: string | null;
  bundleId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  refundedQuantity: number;
  discount: { kind: "percent" | "amount"; value: number; discountId?: string | null } | null;
  lineDiscount: number;
  orderDiscountShare: number;
  promoDiscount: number;
  note: string | null;
  modifiers: { optionId: string | null; name: string; price: number }[];
}
export interface OrderView {
  id: string;
  status: "open" | "paid" | "void";
  receiptNumber: number | null;
  /** Rujukan struk sementara untuk penjualan offline yang belum disinkronkan (belum punya nomor struk resmi). */
  offlineRef?: string;
  salesTypeId: string;
  tableId: string | null;
  customerId: string | null;
  customer: { id: string; name: string; points: number; member: boolean } | null;
  rewardId: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  refundedTotal: number;
  label: string | null;
  note: string | null;
  openedAt: string;
  paidAt: string | null;
  orderDiscount: { kind: "percent" | "amount"; value: number; discountId?: string | null } | null;
  snapshot: PriceResult["snapshot"] | null;
  totals: { subtotal: number; discountTotal: number; base: number; net: number; gratuity: number; tax: number; rounding: number; total: number; paid: number; change: number };
  lines: OrderLineView[];
  payments: { id: string; method: string; tendered: number; applied: number; change: number; reference: string | null }[];
}
export interface OrderSummary {
  id: string;
  status: string;
  receiptNumber: number | null;
  label: string | null;
  tableId?: string | null;
  tableName?: string | null;
  total: number;
  refundedTotal?: number;
  openedAt: string;
}
export interface FloorMap {
  groups: { id: string; name: string }[];
  tables: { id: string; name: string; groupId: string | null; capacity: number; x: number; y: number; shape: "rect" | "round"; open: { count: number; total: number; since: string } | null }[];
}
export interface ShiftView {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  nonCashSales: number;
  orderCount: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number | null;
  actualCash: number | null;
  difference: number | null;
  movements: { id: string; kind: "in" | "out"; amount: number; description: string; at: string }[];
}

/** Mengubah bill yang tersimpan menjadi isi keranjang yang bisa diubah lagi. */
export const cartFromOrder = (o: OrderView): Cart => ({
  salesTypeId: o.salesTypeId,
  tableId: o.tableId,
  customerId: o.customerId,
  rewardId: o.rewardId,
  label: o.label,
  note: o.note,
  orderDiscount: o.orderDiscount?.discountId ? { discountId: o.orderDiscount.discountId, value: o.orderDiscount.value } : null,
  lines: o.lines.map((l): CartLine => {
    const discount = l.discount?.discountId ? { discountId: l.discount.discountId, value: l.discount.value } : null;
    return l.bundleId
      ? { kind: "bundle", bundleId: l.bundleId, quantity: l.quantity, note: l.note, discount }
      : { kind: "item", variantId: l.variantId!, quantity: l.quantity, modifierOptionIds: l.modifiers.flatMap((m) => (m.optionId ? [m.optionId] : [])), note: l.note, discount };
  }),
});

export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  member: boolean;
  points: number;
}
export interface PosReward {
  id: string;
  name: string;
  pointsCost: number;
  kind: "percent_total" | "amount_total" | "item_discount";
  valueKind: "percent" | "amount";
  value: number;
  maxDiscount: number | null;
  minPurchase: number;
}
export interface PosLoyalty {
  enabled: boolean;
  requireCode: boolean;
  rewards: PosReward[];
}

export interface PosSettings {
  checkout: { taxEnabled: boolean; gratuityEnabled: boolean; allowSplitPayment: boolean };
  receipt: import("@/components/ReceiptView").ReceiptSettings;
  outlet: { name: string; address: string | null; phone: string | null };
  paymentMethods: { key: string; name: string | null; cash: boolean }[];
}
