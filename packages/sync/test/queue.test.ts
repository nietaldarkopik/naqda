import { describe, expect, it } from "vitest";
import { MemoryStore, SyncQueue, type SaleOp, type SyncResult } from "../src";

const op = (n: number): SaleOp => ({
  type: "sale",
  clientId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  createdAt: "2026-01-15T03:00:00.000Z",
  clientRef: `OFF-${n}`,
  userId: "u",
  shiftId: "s",
  salesTypeId: "t",
  lines: [],
  orderDiscount: null,
  taxes: [],
  gratuities: [],
  settings: { pricesIncludeTax: false, pricesIncludeGratuity: false, taxOnGratuity: true, roundingStep: 0, roundingMode: "nearest" },
  total: 0,
  payments: [],
});

const created = (o: SaleOp, n: number): SyncResult => ({ clientId: o.clientId, status: "created", orderId: o.clientId, receiptNumber: n });

describe("SyncQueue", () => {
  it("menjaga urutan, mengirim bertahap, dan mengosongkan antrean setelah server menjawab", async () => {
    const sent: string[][] = [];
    const q = new SyncQueue(new MemoryStore(), async (ops) => {
      sent.push(ops.map((o) => o.clientRef));
      return ops.map((o, i) => created(o, sent.flat().length - ops.length + i + 1));
    }, { batchSize: 2 });
    for (const n of [1, 2, 3, 4, 5]) await q.enqueue(op(n));
    expect(await q.flush()).toEqual({ sent: 5, synced: 5, failed: 0, interrupted: false });
    expect(sent).toEqual([["OFF-1", "OFF-2"], ["OFF-3", "OFF-4"], ["OFF-5"]]);
    expect(await q.entries()).toEqual([]);
    expect((await q.synced()).map((r) => r.receiptNumber).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("gangguan jaringan tidak menghilangkan operasi", async () => {
    let up = false;
    const q = new SyncQueue(new MemoryStore(), async (ops) => {
      if (!up) throw new Error("offline");
      return ops.map((o) => created(o, 1));
    });
    await q.enqueue(op(1));
    expect(await q.flush()).toMatchObject({ synced: 0, interrupted: true });
    expect(await q.pendingCount()).toBe(1);
    up = true;
    expect(await q.flush()).toMatchObject({ synced: 1, interrupted: false });
  });

  it("duplicate dianggap berhasil; mengantre id yang sama dua kali tidak menggandakan", async () => {
    const q = new SyncQueue(new MemoryStore(), async (ops) => ops.map((o) => ({ clientId: o.clientId, status: "duplicate" as const, orderId: o.clientId, receiptNumber: 9 })));
    await q.enqueue(op(1));
    await q.enqueue(op(1));
    expect((await q.entries()).length).toBe(1);
    expect(await q.flush()).toMatchObject({ synced: 1 });
    expect((await q.synced())[0]).toMatchObject({ receiptNumber: 9 });
  });

  it("ditolak permanen: berstatus failed, tidak dikirim ulang otomatis, bisa dicoba lagi atau dibuang", async () => {
    let calls = 0;
    let accept = false;
    const q = new SyncQueue(new MemoryStore(), async (ops) => {
      calls += 1;
      return ops.map((o) => (accept ? created(o, 1) : { clientId: o.clientId, status: "rejected" as const, code: "invalid_items", message: "item tidak dikenal" }));
    });
    await q.enqueue(op(1));
    await q.enqueue(op(2));
    expect(await q.flush()).toMatchObject({ sent: 2, synced: 0, failed: 2 });
    const [a, b] = await q.entries();
    expect(a).toMatchObject({ state: "failed", lastError: "item tidak dikenal", code: "invalid_items", attempts: 1 });
    expect(await q.flush()).toMatchObject({ sent: 0 });
    expect(calls).toBe(1);

    accept = true;
    await q.retry(a!.op.clientId);
    expect(await q.flush()).toMatchObject({ synced: 1 });
    expect(await q.discard(b!.op.clientId)).toBe(true);
    expect(await q.entries()).toEqual([]);
  });

  it("operasi yang masih menunggu tidak bisa dibuang", async () => {
    const q = new SyncQueue(new MemoryStore(), async () => {
      throw new Error("offline");
    });
    await q.enqueue(op(1));
    expect(await q.discard(op(1).clientId)).toBe(false);
    expect(await q.pendingCount()).toBe(1);
  });

  it("penolakan sementara (mis. belum ada shift) tetap menunggu dan tidak membuat perulangan tanpa akhir", async () => {
    let calls = 0;
    const q = new SyncQueue(new MemoryStore(), async (ops) => {
      calls += 1;
      return ops.map((o) => ({ clientId: o.clientId, status: "rejected" as const, code: "no_shift", retryable: true }));
    });
    await q.enqueue(op(1));
    expect(await q.flush()).toMatchObject({ synced: 0, failed: 0, interrupted: true });
    expect(calls).toBe(1);
    expect(await q.pendingCount()).toBe(1);
  });

  it("pengiriman paralel berbagi satu proses", async () => {
    let calls = 0;
    const q = new SyncQueue(new MemoryStore(), async (ops) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return ops.map((o) => created(o, 1));
    });
    await q.enqueue(op(1));
    const [a, b] = await Promise.all([q.flush(), q.flush()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("rujukan struk sementara berurutan per hari dan mulai dari 1 pada hari baru", async () => {
    let now = new Date("2026-01-15T03:00:00Z");
    const q = new SyncQueue(new MemoryStore(), async () => [], { now: () => now });
    expect(await q.nextRef()).toBe("OFF-260115-0001");
    expect(await q.nextRef()).toBe("OFF-260115-0002");
    now = new Date("2026-01-16T03:00:00Z");
    expect(await q.nextRef()).toBe("OFF-260116-0001");
  });

  it("memberi tahu pendengar saat antrean berubah", async () => {
    const q = new SyncQueue(new MemoryStore(), async (ops) => ops.map((o) => created(o, 1)));
    let n = 0;
    const off = q.subscribe(() => (n += 1));
    await q.enqueue(op(1));
    await q.flush();
    expect(n).toBeGreaterThanOrEqual(2);
    off();
    const before = n;
    await q.enqueue(op(2));
    expect(n).toBe(before);
  });
});
