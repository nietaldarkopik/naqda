"use client";

import { useEffect, useRef } from "react";
import { ScanDetector } from "@naqdi/domain";

const isEditable = (el: EventTarget | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
};

/**
 * Scanner barcode mode keyboard (USB/Bluetooth): "mengetik" kode dengan jeda antar-tombol sangat pendek lalu Enter.
 * Aturan agar tidak salah tangkap:
 * - diam bila ada dialog terbuka (mis. sedang membayar) atau tombol Ctrl/Alt/Meta ditekan;
 * - diam bila fokus ada di kolom isian, KECUALI kolom yang diberi atribut `data-scan-ok` (kolom cari katalog);
 * - ketikan manusia (jeda > ~40 ms) tidak pernah dianggap scan.
 * Saat scan terdeteksi, kejadian Enter dihentikan agar tidak ikut menekan tombol yang sedang terfokus.
 */
export const useBarcodeScanner = (onScan: (code: string) => void, enabled = true): void => {
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const detector = new ScanDetector({ maxGapMs: 40, minLength: 3 });
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) {
        detector.reset();
        return;
      }
      if (isEditable(e.target) && !e.target.hasAttribute("data-scan-ok")) {
        detector.reset();
        return;
      }
      const code = detector.key(e.key, e.timeStamp);
      if (code) {
        e.preventDefault();
        e.stopPropagation();
        handler.current(code);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
};

let audio: AudioContext | null = null;

/** Bunyi pendek umpan balik scan: tinggi = berhasil, rendah = tidak dikenal. Diam-diam tidak berefek bila audio tak tersedia. */
export const beep = (kind: "ok" | "bad"): void => {
  try {
    audio ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === "ok" ? 1200 : 260;
    osc.type = kind === "ok" ? "sine" : "square";
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + (kind === "ok" ? 0.09 : 0.25));
  } catch {
    /* tanpa audio */
  }
};
