import type { SaleOp, SyncResult } from "./protocol";
import type { LocalStore } from "./store";

export interface QueueEntry {
  seq: number;
  op: SaleOp;
  /** pending: menunggu atau dicoba lagi otomatis; failed: ditolak server dan butuh tindakan kasir. */
  state: "pending" | "failed";
  attempts: number;
  lastError?: string;
  code?: string;
}

export interface SyncedRecord {
  clientId: string;
  clientRef: string;
  orderId: string;
  receiptNumber: number | null;
  flags: string[];
  at: string;
}

export interface FlushReport {
  sent: number;
  synced: number;
  failed: number;
  /** Jaringan/sesi gagal, atau sisa antrean menunggu alasan sementara, sehingga pengiriman dihentikan. */
  interrupted: boolean;
}

export type Transport = (ops: SaleOp[]) => Promise<SyncResult[]>;

const QUEUE = "queue";
const SYNCED = "synced";
const META = "meta";
const SYNCED_KEEP = 50;
const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * Antrean operasi offline di atas `LocalStore`. Urutan dijaga lewat `seq`; operasi hanya hilang dari antrean setelah
 * server menjawab `created`/`duplicate`, sehingga gangguan di tengah pengiriman tidak pernah menghilangkan penjualan.
 */
export class SyncQueue {
  private flushing: Promise<FlushReport> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: LocalStore,
    private readonly transport: Transport,
    private readonly options: { batchSize?: number; now?: () => Date } = {},
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async bump(name: string): Promise<number> {
    const next = ((await this.store.get<number>(META, name)) ?? 0) + 1;
    await this.store.put(META, name, next);
    return next;
  }

  /** Rujukan struk sementara yang berurutan per perangkat per hari, mis. OFF-260115-0003. */
  async nextRef(): Promise<string> {
    const d = (this.options.now?.() ?? new Date()).toISOString().slice(2, 10).replaceAll("-", "");
    const last = await this.store.get<{ day: string; n: number }>(META, "ref");
    const n = last && last.day === d ? last.n + 1 : 1;
    await this.store.put(META, "ref", { day: d, n });
    return `OFF-${d}-${pad(n, 4)}`;
  }

  async enqueue(op: SaleOp): Promise<QueueEntry> {
    const existing = await this.store.get<QueueEntry>(QUEUE, op.clientId);
    if (existing) return existing;
    const entry: QueueEntry = { seq: await this.bump("seq"), op, state: "pending", attempts: 0 };
    await this.store.put(QUEUE, op.clientId, entry);
    this.emit();
    return entry;
  }

  async entries(): Promise<QueueEntry[]> {
    return (await this.store.list<QueueEntry>(QUEUE)).map((r) => r.value).sort((a, b) => a.seq - b.seq);
  }

  async synced(): Promise<SyncedRecord[]> {
    return (await this.store.list<SyncedRecord>(SYNCED)).map((r) => r.value).sort((a, b) => b.at.localeCompare(a.at) || b.clientRef.localeCompare(a.clientRef));
  }

  async pendingCount(): Promise<number> {
    return (await this.entries()).filter((e) => e.state === "pending").length;
  }

  /** Mengembalikan operasi gagal ke antrean agar dikirim lagi (mis. setelah masalah di sisi toko diperbaiki). */
  async retry(clientId: string): Promise<void> {
    const e = await this.store.get<QueueEntry>(QUEUE, clientId);
    if (!e) return;
    await this.store.put(QUEUE, clientId, { ...e, state: "pending" });
    this.emit();
  }

  /** Membuang operasi yang gagal. Hanya untuk operasi `failed`: yang masih menunggu tidak boleh dibuang. */
  async discard(clientId: string): Promise<boolean> {
    const e = await this.store.get<QueueEntry>(QUEUE, clientId);
    if (!e || e.state !== "failed") return false;
    await this.store.delete(QUEUE, clientId);
    this.emit();
    return true;
  }

  flush(): Promise<FlushReport> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
      this.emit();
    });
    return this.flushing;
  }

  private async run(): Promise<FlushReport> {
    const report: FlushReport = { sent: 0, synced: 0, failed: 0, interrupted: false };
    const batchSize = this.options.batchSize ?? 25;
    for (;;) {
      const batch = (await this.entries()).filter((e) => e.state === "pending").slice(0, batchSize);
      if (batch.length === 0) return report;
      let results: SyncResult[];
      try {
        results = await this.transport(batch.map((e) => e.op));
      } catch {
        report.interrupted = true;
        return report;
      }
      report.sent += batch.length;
      const byId = new Map(results.map((r) => [r.clientId, r]));
      let progressed = false;
      for (const e of batch) {
        const r = byId.get(e.op.clientId);
        if (!r) {
          await this.store.put(QUEUE, e.op.clientId, { ...e, attempts: e.attempts + 1, lastError: "no_result" });
          continue;
        }
        if (r.status === "rejected") {
          const failed = !r.retryable;
          await this.store.put(QUEUE, e.op.clientId, {
            ...e,
            state: failed ? "failed" : "pending",
            attempts: e.attempts + 1,
            lastError: r.message ?? r.code ?? "rejected",
            ...(r.code ? { code: r.code } : {}),
          });
          if (failed) {
            report.failed += 1;
            progressed = true;
          }
          continue;
        }
        await this.store.delete(QUEUE, e.op.clientId);
        await this.store.put<SyncedRecord>(SYNCED, e.op.clientId, {
          clientId: e.op.clientId,
          clientRef: e.op.clientRef,
          orderId: r.orderId ?? e.op.clientId,
          receiptNumber: r.receiptNumber ?? null,
          flags: r.flags ?? [],
          at: (this.options.now?.() ?? new Date()).toISOString(),
        });
        report.synced += 1;
        progressed = true;
      }
      await this.trimSynced();
      this.emit();
      // Tanpa kemajuan (semua menunggu karena alasan sementara): berhenti agar tidak berputar tanpa akhir.
      if (!progressed) {
        report.interrupted = true;
        return report;
      }
    }
  }

  private async trimSynced(): Promise<void> {
    for (const r of (await this.synced()).slice(SYNCED_KEEP)) await this.store.delete(SYNCED, r.clientId);
  }
}
