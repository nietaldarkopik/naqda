"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { HardwareError, type PaperMm, type PrinterInfo } from "@naqdi/hardware";
import { Badge, Button, Modal, useToast } from "@/components/ui";
import { getHardware } from "@/lib/hardware";
import { renderTestJob } from "@/lib/hardware/receiptRaster";
import { loadPrinterPrefs, savePrinterPrefs, type PrinterPrefs } from "@/lib/hardware/printerStore";

/** Pesan galat perangkat keras yang ramah untuk kasir. */
export const hardwareErrorKey = (e: unknown): "permission_denied" | "connect_failed" | "write_failed" | "unsupported" | "other" => {
  if (e instanceof HardwareError) {
    if (e.code === "permission_denied" || e.code === "connect_failed" || e.code === "write_failed" || e.code === "unsupported") return e.code;
  }
  return "other";
};

/** Memilih printer Bluetooth, mencoba cetak, dan mengatur cetak otomatis dan laci kas. Hanya dibuka di aplikasi native. */
export function PrinterDialog({ paperMm, onClose, onChange }: { paperMm: PaperMm; onClose: () => void; onChange?: (prefs: PrinterPrefs) => void }) {
  const t = useTranslations("hardware");
  const toast = useToast();
  const [prefs, setPrefs] = useState<PrinterPrefs>(() => loadPrinterPrefs());
  const [found, setFound] = useState<PrinterInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");

  const update = (next: PrinterPrefs) => {
    setPrefs(next);
    savePrinterPrefs(next);
    onChange?.(next);
  };

  const scan = async () => {
    setScanning(true);
    setError("");
    setFound(null);
    try {
      setFound(await (await getHardware()).listPrinters());
    } catch (e) {
      setError(t(`error.${hardwareErrorKey(e)}` as never));
    } finally {
      setScanning(false);
    }
  };

  const test = async () => {
    if (!prefs.printer) return;
    setPrinting(true);
    setError("");
    try {
      const hw = await getHardware();
      await hw.printReceipt(prefs.printer, await renderTestJob(paperMm));
      toast(t("printed"));
    } catch (e) {
      setError(t(`error.${hardwareErrorKey(e)}` as never));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Modal open title={t("title")} onClose={onClose} footer={<Button onClick={onClose} data-testid="printer-close">{t("done")}</Button>}>
      <div className="space-y-4 text-sm" data-testid="printer-dialog">
        <p className="text-muted">{t("hint", { paper: paperMm })}</p>

        <div className="rounded-lg border border-line p-3">
          <div className="text-muted">{t("selected")}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-medium" data-testid="printer-selected">
            {prefs.printer ? (
              <>
                <span dir="auto">{prefs.printer.name}</span>
                <Badge tone="good">{prefs.printer.id}</Badge>
                <Button variant="secondary" disabled={printing} onClick={() => void test()} data-testid="printer-test">{t("testPrint")}</Button>
                <Button variant="ghost" onClick={() => update({ ...prefs, printer: null })}>{t("forget")}</Button>
              </>
            ) : (
              <span className="text-muted">{t("none")}</span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Button variant="secondary" disabled={scanning} onClick={() => void scan()} data-testid="printer-scan">{scanning ? t("scanning") : t("scan")}</Button>
          {found?.length === 0 ? <p className="text-muted" data-testid="printer-empty">{t("noneFound")}</p> : null}
          <ul className="divide-y divide-line rounded-lg border border-line empty:hidden">
            {found?.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span dir="auto">{p.name} <span className="text-muted" dir="ltr">{p.id}</span></span>
                <Button variant={prefs.printer?.id === p.id ? "ghost" : "secondary"} onClick={() => update({ ...prefs, printer: p })} data-testid="printer-pick">{prefs.printer?.id === p.id ? t("chosen") : t("choose")}</Button>
              </li>
            ))}
          </ul>
        </div>

        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={prefs.autoPrint} onChange={(e) => update({ ...prefs, autoPrint: e.target.checked })} data-testid="printer-auto" />
          <span><span className="block font-medium">{t("autoPrint")}</span><span className="block text-muted">{t("autoPrintHint")}</span></span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={prefs.openDrawer} onChange={(e) => update({ ...prefs, openDrawer: e.target.checked })} />
          <span><span className="block font-medium">{t("openDrawer")}</span><span className="block text-muted">{t("openDrawerHint")}</span></span>
        </label>

        {error ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-danger" data-testid="printer-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
