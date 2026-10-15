"use client";

import { useCallback, useEffect, useState } from "react";

/** Mode layar penuh (Fullscreen API). `supported` false di iPhone/Safari tertentu: tombolnya disembunyikan. */
export const useFullscreen = () => {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    setSupported(Boolean(document.fullscreenEnabled));
    const sync = () => setActive(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* ditolak browser (butuh sentuhan pengguna): abaikan */
    }
  }, []);
  return { supported, active, toggle };
};

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/** Menjaga layar tetap menyala selama kasir terbuka (tablet kasir jangan tidur di tengah antrean). Diam-diam tak berefek bila tak didukung. */
export const useWakeLock = (enabled: boolean) => {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!enabled || !api) return;
    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || lock) return;
      try {
        const l = await api.request("screen");
        if (cancelled) void l.release();
        else lock = l;
      } catch {
        /* baterai hemat atau ditolak */
      }
    };
    // Kunci dilepas browser saat tab disembunyikan; ambil lagi saat tampil kembali.
    const onVisible = () => {
      lock = null;
      void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
};
