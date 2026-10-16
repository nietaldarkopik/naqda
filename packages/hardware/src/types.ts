/**
 * Antarmuka perangkat keras untuk kasir. Kode UI hanya memanggil antarmuka ini; tiap platform punya adapter sendiri:
 * Web (window.print dan scanner keyboard), Mobile/Capacitor (printer Bluetooth, kamera), Desktop/Tauri (USB/serial) kelak.
 * Paket ini tidak mengimpor React atau API browser.
 */

export interface PrinterInfo {
  /** Pengenal yang dipakai adapter untuk tersambung (di Android: alamat MAC). */
  id: string;
  name: string;
}

export type PaperMm = 58 | 80;

export interface PrintOptions {
  paperMm: PaperMm;
  /** Buka laci kas setelah mencetak. */
  openDrawer?: boolean;
  cut?: boolean;
}

export interface Hardware {
  /** Nama adapter untuk diagnosis: "web" | "capacitor". */
  readonly platform: string;
  /** Printer struk langsung (tanpa dialog cetak browser) tersedia di platform ini? */
  readonly canPrintDirect: boolean;
  /** Pemindai kamera tersedia di platform ini? (Scanner USB/Bluetooth mode keyboard selalu didukung lewat useBarcodeScanner.) */
  readonly canScanCamera: boolean;

  /** Daftar printer yang sudah dipasangkan (paired) dengan perangkat. */
  listPrinters(): Promise<PrinterInfo[]>;
  /** Mencetak bitmap struk (1-bit) ke printer terpilih. Melempar HardwareError bila gagal. */
  printReceipt(printer: PrinterInfo, job: Uint8Array[]): Promise<void>;
  /** Memindai satu barcode dengan kamera; null bila dibatalkan. */
  scanBarcode(): Promise<string | null>;
}

export type HardwareErrorCode = "unsupported" | "permission_denied" | "not_found" | "connect_failed" | "write_failed" | "cancelled";

export class HardwareError extends Error {
  constructor(
    public readonly code: HardwareErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HardwareError";
  }
}
