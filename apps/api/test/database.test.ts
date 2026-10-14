import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { categories, newId, nonInnoDbTables, outlets } from "@naqdi/db";
import { setupFixture, type Fixture } from "./helpers";

let fx: Fixture;

beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.handle.close();
});

// Tes ini ada karena MySQL bawaan sebagian paket (mis. WAMP) memakai MyISAM: tanpa transaksi dan tanpa foreign key.
describe("integritas database", () => {
  it("semua tabel memakai InnoDB", async () => {
    expect(await nonInnoDbTables(fx.handle)).toEqual([]);
  });

  it("foreign key benar-benar ditegakkan (outlet tanpa bisnis ditolak)", async () => {
    const insert = fx.handle.db.insert(outlets).values({ id: newId(), businessId: newId(), name: "Yatim" });
    await expect(insert).rejects.toThrow();
  });

  it("rollback transaksi membatalkan semua perubahan di dalamnya", async () => {
    const id = newId();
    const name = `Rollback ${id}`;
    await expect(
      fx.handle.db.transaction(async (tx) => {
        await tx.insert(categories).values({ id, businessId: fx.a.businessId, name });
        throw new Error("batal di tengah jalan");
      }),
    ).rejects.toThrow("batal di tengah jalan");
    const rows = await fx.handle.db.select().from(categories).where(and(eq(categories.id, id)));
    expect(rows).toHaveLength(0);
  });

  it("commit transaksi menyimpan perubahan", async () => {
    const id = newId();
    await fx.handle.db.transaction(async (tx) => {
      await tx.insert(categories).values({ id, businessId: fx.a.businessId, name: `Commit ${id}` });
    });
    expect(await fx.handle.db.select().from(categories).where(eq(categories.id, id))).toHaveLength(1);
  });

  it("sesi memakai UTC dan utf8mb4 (huruf Arab tersimpan utuh)", async () => {
    const id = newId();
    const arabic = "قهوة عربية ☕";
    await fx.handle.db.insert(categories).values({ id, businessId: fx.a.businessId, name: arabic });
    const [row] = await fx.handle.db.select().from(categories).where(eq(categories.id, id));
    expect(row?.name).toBe(arabic);
    const [tz] = (await fx.handle.pool.query("SELECT @@session.time_zone AS tz")) as unknown as [Array<{ tz: string }>];
    expect(tz[0]?.tz).toBe("+00:00");
  });
});
