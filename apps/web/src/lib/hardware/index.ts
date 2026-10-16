"use client";

import { Capacitor } from "@capacitor/core";
import { HardwareError, type Hardware, type PrinterInfo } from "@naqdi/hardware";

declare global {
  interface Window {
    /** Adapter yang disuntikkan cangkang pembungkus (mis. Tauri di desktop kelak) atau skrip uji; mengalahkan deteksi Capacitor. */
    __NAQDI_HARDWARE__?: Hardware;
  }
}

/** Berjalan di dalam aplikasi pembungkus (Android/iOS lewat Capacitor, atau cangkang lain yang menyuntikkan adapter), bukan di browser biasa? */
export const isNativeApp = (): boolean => {
  try {
    return Boolean(window.__NAQDI_HARDWARE__) || Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** Adapter web: tanpa printer langsung (memakai dialog cetak browser) dan tanpa pemindai kamera khusus. */
const webHardware: Hardware = {
  platform: "web",
  canPrintDirect: false,
  canScanCamera: false,
  async listPrinters() {
    throw new HardwareError("unsupported");
  },
  async printReceipt() {
    throw new HardwareError("unsupported");
  },
  async scanBarcode() {
    throw new HardwareError("unsupported");
  },
};

let cached: Hardware | null = null;

/** Adapter sesuai platform saat ini. Plugin native dimuat malas, jadi bundel web biasa tidak ikut menanggungnya. */
export const getHardware = async (): Promise<Hardware> => {
  if (typeof window !== "undefined" && window.__NAQDI_HARDWARE__) return window.__NAQDI_HARDWARE__;
  if (cached) return cached;
  if (!isNativeApp()) return (cached = webHardware);
  const { capacitorHardware } = await import("./capacitor");
  return (cached = capacitorHardware());
};

export type { PrinterInfo };
