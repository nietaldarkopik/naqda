import type { PrinterInfo } from "@naqdi/hardware";

/** Pilihan printer per perangkat kasir (bukan per bisnis): disimpan di penyimpanan lokal perangkat. */
export interface PrinterPrefs {
  printer: PrinterInfo | null;
  /** Cetak otomatis setelah pembayaran selesai. */
  autoPrint: boolean;
  /** Buka laci kas bersama cetak. */
  openDrawer: boolean;
}

const KEY = "naqdi.printer";
const empty: PrinterPrefs = { printer: null, autoPrint: false, openDrawer: false };

export const loadPrinterPrefs = (): PrinterPrefs => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<PrinterPrefs>;
    const printer = p.printer && typeof p.printer.id === "string" && typeof p.printer.name === "string" ? { id: p.printer.id, name: p.printer.name } : null;
    return { printer, autoPrint: p.autoPrint === true, openDrawer: p.openDrawer === true };
  } catch {
    return empty;
  }
};

export const savePrinterPrefs = (prefs: PrinterPrefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* penyimpanan penuh atau dimatikan: pilihan tidak diingat */
  }
};
