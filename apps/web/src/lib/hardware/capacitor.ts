import { HardwareError, type Hardware, type PrinterInfo } from "@naqdi/hardware";

/**
 * Adapter Capacitor (Android): printer Bluetooth lewat plugin capacitor-thermal-printer (mengirim byte ESC/POS mentah)
 * dan pemindai kamera lewat Google Code Scanner (ML Kit; tidak butuh izin kamera karena UI pemindai milik Google Play services).
 *
 * BELUM DIUJI di perangkat sungguhan: kode ini hanya bisa diverifikasi di tablet Android dengan printer Bluetooth nyata.
 * Lihat docs/08-mobile.md bagian "Yang belum terverifikasi".
 */

const SCAN_SECONDS = 6;

const toHardwareError = (e: unknown, fallback: "connect_failed" | "write_failed"): HardwareError => {
  if (e instanceof HardwareError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/permission/i.test(message)) return new HardwareError("permission_denied", message);
  return new HardwareError(fallback, message);
};

export const capacitorHardware = (): Hardware => ({
  platform: "capacitor",
  canPrintDirect: true,
  canScanCamera: true,

  async listPrinters(): Promise<PrinterInfo[]> {
    const { CapacitorThermalPrinter } = await import("capacitor-thermal-printer");
    const found = new Map<string, PrinterInfo>();
    const handle = await CapacitorThermalPrinter.addListener("discoverDevices", (data) => {
      for (const d of data.devices) found.set(d.address, { id: d.address, name: d.name || d.address });
    });
    try {
      await CapacitorThermalPrinter.startScan();
      await new Promise((resolve) => setTimeout(resolve, SCAN_SECONDS * 1000));
      await CapacitorThermalPrinter.stopScan().catch(() => undefined);
    } catch (e) {
      throw toHardwareError(e, "connect_failed");
    } finally {
      await handle.remove();
    }
    return [...found.values()];
  },

  async printReceipt(printer, job) {
    const { CapacitorThermalPrinter } = await import("capacitor-thermal-printer");
    try {
      // Tersambung ulang tiap cetak bila perlu: koneksi Bluetooth sering terputus sendiri saat printer tidur.
      if (!(await CapacitorThermalPrinter.isConnected())) {
        const device = await CapacitorThermalPrinter.connect({ address: printer.id });
        if (device === null) throw new HardwareError("connect_failed", printer.name);
      }
    } catch (e) {
      throw toHardwareError(e, "connect_failed");
    }
    try {
      let builder = CapacitorThermalPrinter.begin();
      for (const part of job) builder = builder.raw(new Uint8Array(part));
      await builder.write();
    } catch (e) {
      throw toHardwareError(e, "write_failed");
    }
  },

  async scanBarcode() {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    try {
      const available = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available.available) await BarcodeScanner.installGoogleBarcodeScannerModule();
      const result = await BarcodeScanner.scan();
      return result.barcodes[0]?.rawValue ?? null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(message)) return null;
      throw toHardwareError(e, "connect_failed");
    }
  },
});
