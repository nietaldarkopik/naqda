import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isLocalDate, localDayStartUtc, localMoment, localRangeUtc, splitRefund } from "../src/index";

describe("tanggal setempat", () => {
  it("awal hari di Jakarta (UTC+7) adalah 17:00 UTC hari sebelumnya", () => {
    expect(localDayStartUtc("2026-10-15", "Asia/Jakarta").toISOString()).toBe("2026-10-14T17:00:00.000Z");
    expect(localDayStartUtc("2026-10-15", "Asia/Riyadh").toISOString()).toBe("2026-10-14T21:00:00.000Z");
    expect(localDayStartUtc("2026-10-15", "UTC").toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("menangani DST (New York: musim panas UTC-4, musim dingin UTC-5, hari peralihan 23 jam)", () => {
    expect(localDayStartUtc("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(localDayStartUtc("2026-12-01", "America/New_York").toISOString()).toBe("2026-12-01T05:00:00.000Z");
    const r = localRangeUtc("2026-03-08", "2026-03-08", "America/New_York"); // hari mulai DST
    expect((r.end.getTime() - r.start.getTime()) / 3_600_000).toBe(23);
    const f = localRangeUtc("2026-11-01", "2026-11-01", "America/New_York"); // hari akhir DST
    expect((f.end.getTime() - f.start.getTime()) / 3_600_000).toBe(25);
  });

  it("localMoment: tanggal, jam, hari-minggu menurut zona", () => {
    const at = new Date("2026-10-14T17:30:00Z"); // 00:30 Kamis 15 Okt di Jakarta, Rabu 14 Okt di UTC
    expect(localMoment(at, "Asia/Jakarta")).toEqual({ date: "2026-10-15", hour: 0, weekday: 4 });
    expect(localMoment(at, "UTC")).toEqual({ date: "2026-10-14", hour: 17, weekday: 3 });
  });

  it("rentang tidak tumpang tindih: akhir sebuah hari = awal hari berikutnya", () => {
    const a = localRangeUtc("2026-10-14", "2026-10-14", "Asia/Jakarta");
    const b = localRangeUtc("2026-10-15", "2026-10-15", "Asia/Jakarta");
    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  it("validasi dan hitung tanggal", () => {
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-2-3")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(31);
    expect(() => localDayStartUtc("bukan", "UTC")).toThrow(RangeError);
  });
});

describe("rincian refund", () => {
  it("jumlah net + service + pajak tepat sama dengan refund, untuk banyak kombinasi", () => {
    for (const total of [1, 77, 1000, 73_260, 99_999]) {
      for (const [gratuity, tax] of [[0, 0], [0, Math.floor(total / 10)], [Math.floor(total / 20), Math.floor(total / 9)]] as const) {
        for (const refund of [1, 2, Math.floor(total / 3) || 1, total]) {
          if (refund > total) continue;
          const r = splitRefund(refund, { total, gratuity, tax });
          expect(r.net + r.gratuity + r.tax).toBe(refund);
          expect(r.net).toBeGreaterThanOrEqual(0);
          expect(r.gratuity).toBeGreaterThanOrEqual(0);
          expect(r.tax).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("contoh tangan: refund sepertiga dari 73.260 (pajak 7.260)", () => {
    expect(splitRefund(24_420, { total: 73_260, gratuity: 0, tax: 7_260 })).toEqual({ net: 22_000, gratuity: 0, tax: 2_420 });
  });
});
