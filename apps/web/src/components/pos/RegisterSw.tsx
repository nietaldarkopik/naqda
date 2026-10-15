"use client";

import { useEffect } from "react";

/**
 * Mendaftarkan Service Worker kasir (hanya di produksi: di mode dev, cache akan mengganggu muat ulang cepat).
 * Setelah aktif, URL halaman dan aset yang sudah dimuat dikirim agar ikut tersimpan untuk dipakai offline.
 */
export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled) return;
        const urls = [location.href, ...performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/"))];
        reg.active?.postMessage({ type: "cache-urls", urls });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
