"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SyncQueue, type LocalStore, type QueueEntry, type SyncResult, type SyncedRecord, type Transport } from "@naqdi/sync";
import { getOnline, posApi, setOnline, subscribeOnline } from "@/lib/posClient";
import { openLocalStore } from "./idb";

/**
 * Mesin offline kasir di sisi web: satu antrean per perangkat (bertahan lintas login), cache data acuan
 * (katalog, harga, pengaturan) untuk berjualan tanpa server, dan hook yang mengirim antrean saat online.
 */

export interface OfflineEngine {
  queue: SyncQueue;
  store: LocalStore;
  /** false bila penyimpanan permanen tidak tersedia: penjualan offline hilang bila halaman ditutup. */
  persistent: boolean;
}

const transport: Transport = async (ops) => (await posApi<{ results: SyncResult[] }>("/sync", { method: "POST", json: { ops } })).results;

let engine: Promise<OfflineEngine> | null = null;
export const getEngine = (): Promise<OfflineEngine> =>
  (engine ??= openLocalStore().then(({ store, persistent }) => ({ store, persistent, queue: new SyncQueue(store, transport) })));

// ---- cache data acuan

const CACHE = "cache";
export type RefKey = "catalog" | "pack" | "settings";

interface CacheRecord<T> {
  outletId: string;
  savedAt: string;
  data: T;
}

export const saveRef = async <T,>(key: RefKey, outletId: string, data: T): Promise<void> => {
  try {
    await (await getEngine()).store.put<CacheRecord<T>>(CACHE, key, { outletId, savedAt: new Date().toISOString(), data });
  } catch {
    /* penyimpanan penuh atau diblokir: berjualan offline tidak tersedia, tetapi mode online tidak terganggu */
  }
};

/** Cache hanya dipakai bila berasal dari outlet yang sama dengan perangkat saat ini. */
export const loadRef = async <T,>(key: RefKey, outletId: string): Promise<{ data: T; savedAt: string } | null> => {
  try {
    const rec = await (await getEngine()).store.get<CacheRecord<T>>(CACHE, key);
    return rec && rec.outletId === outletId ? { data: rec.data, savedAt: rec.savedAt } : null;
  } catch {
    return null;
  }
};

// ---- status antrean untuk UI

export interface OfflineStatus {
  online: boolean;
  pending: number;
  failed: number;
  syncing: boolean;
  /** Bertambah setiap kali ada penjualan yang berhasil disinkronkan (untuk memuat ulang ringkasan shift). */
  syncedTick: number;
  persistent: boolean;
  entries: QueueEntry[];
  synced: SyncedRecord[];
  flush: () => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  discard: (clientId: string) => Promise<void>;
}

const FLUSH_EVERY_MS = 30_000;
const PROBE_EVERY_MS = 8_000;

/**
 * `active` = ada sesi kasir (mengirim butuh token sesi). Mengirim antrean saat online, setiap 30 detik selama masih ada
 * yang menunggu, dan segera setelah koneksi pulih. Saat offline, server dicek tiap beberapa detik agar pulihnya terdeteksi.
 */
export const useOfflineStatus = (active: boolean): OfflineStatus => {
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [synced, setSynced] = useState<SyncedRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const [persistent, setPersistent] = useState(true);

  const refresh = useCallback(async () => {
    const { queue, persistent: p } = await getEngine();
    setPersistent(p);
    setEntries(await queue.entries());
    setSynced(await queue.synced());
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void getEngine().then(({ queue }) => {
      if (!alive) return;
      off = queue.subscribe(() => void refresh());
      void refresh();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [refresh]);

  const flush = useCallback(async () => {
    const { queue } = await getEngine();
    setSyncing(true);
    try {
      const report = await queue.flush();
      if (report.synced > 0) setTick((n) => n + 1);
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  const pending = entries.filter((e) => e.state === "pending").length;
  const failed = entries.filter((e) => e.state === "failed").length;

  useEffect(() => {
    if (active && online) void flush();
  }, [active, online, flush]);

  useEffect(() => {
    if (!active || !online || pending === 0) return;
    const id = setInterval(() => void flush(), FLUSH_EVERY_MS);
    return () => clearInterval(id);
  }, [active, online, pending, flush]);

  // Peristiwa browser hanya petunjuk: "offline" langsung dipercaya, "online" harus dibuktikan dengan menjangkau server.
  useEffect(() => {
    const probe = () =>
      fetch("/api/v1/health", { cache: "no-store" })
        .then((r) => {
          if (r.ok) setOnline(true);
        })
        .catch(() => undefined);
    const goOffline = () => setOnline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", probe);
    const id = online ? undefined : setInterval(probe, PROBE_EVERY_MS);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", probe);
      if (id) clearInterval(id);
    };
  }, [online]);

  const retry = useCallback(
    async (clientId: string) => {
      await (await getEngine()).queue.retry(clientId);
      await refresh();
      if (getOnline()) void flush();
    },
    [refresh, flush],
  );
  const discard = useCallback(
    async (clientId: string) => {
      await (await getEngine()).queue.discard(clientId);
      await refresh();
    },
    [refresh],
  );

  return { online, pending, failed, syncing, syncedTick: tick, persistent, entries, synced, flush, retry, discard };
};
