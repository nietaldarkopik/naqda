import { describe, expect, it } from "vitest";
import { GRACE_DAYS, TRIAL_DAYS, accessOf, limitsOf, nextPeriodEnd, planLimits, trialEndFrom } from "../src";

const D = 86_400_000;
const t0 = new Date("2026-03-10T08:00:00Z");

describe("akses menurut status dan tanggal", () => {
  it("uji coba berjalan penuh dengan sisa hari, lalu masa tenggang, lalu terkunci", () => {
    const end = trialEndFrom(t0);
    expect(end.getTime() - t0.getTime()).toBe(TRIAL_DAYS * D);
    const b = { status: "trial", trialEndsAt: end, currentPeriodEndsAt: null } as const;

    expect(accessOf(b, t0)).toMatchObject({ level: "full", reason: "trial", daysLeft: 14, graceDaysLeft: null });
    expect(accessOf(b, new Date(end.getTime() - 1))).toMatchObject({ level: "full", daysLeft: 1 });
    expect(accessOf(b, end)).toMatchObject({ level: "full", reason: "trial" }); // tepat di batas masih berlaku

    const grace = accessOf(b, new Date(end.getTime() + 2 * D));
    expect(grace).toMatchObject({ level: "grace", reason: "trial_expired", daysLeft: -2, graceDaysLeft: GRACE_DAYS - 2 });
    expect(accessOf(b, new Date(end.getTime() + GRACE_DAYS * D))).toMatchObject({ level: "grace" }); // hari terakhir tenggang
    expect(accessOf(b, new Date(end.getTime() + GRACE_DAYS * D + 1))).toMatchObject({ level: "locked", reason: "trial_expired" });
  });

  it("berlangganan: penuh sampai akhir periode, tenggang, lalu terkunci; tanpa tanggal = tanpa batas", () => {
    const end = new Date(t0.getTime() + 30 * D);
    const b = { status: "active", trialEndsAt: null, currentPeriodEndsAt: end } as const;
    expect(accessOf(b, t0)).toMatchObject({ level: "full", reason: "active", daysLeft: 30 });
    expect(accessOf(b, new Date(end.getTime() + D))).toMatchObject({ level: "grace", reason: "period_expired" });
    expect(accessOf(b, new Date(end.getTime() + (GRACE_DAYS + 1) * D))).toMatchObject({ level: "locked" });
    expect(accessOf({ status: "active", trialEndsAt: null, currentPeriodEndsAt: null }, new Date("2099-01-01"))).toMatchObject({ level: "full", daysLeft: null });
  });

  it("jatuh tempo (past_due) tetap berjalan selama tenggang, lalu terkunci", () => {
    const end = new Date(t0.getTime() - 3 * D);
    const b = { status: "past_due", trialEndsAt: null, currentPeriodEndsAt: end } as const;
    expect(accessOf(b, t0)).toMatchObject({ level: "grace", graceDaysLeft: GRACE_DAYS - 3 });
    expect(accessOf(b, new Date(t0.getTime() + 10 * D))).toMatchObject({ level: "locked" });
  });

  it("ditangguhkan dan dibatalkan selalu terkunci, berapa pun tanggalnya", () => {
    const far = new Date("2099-01-01");
    expect(accessOf({ status: "suspended", trialEndsAt: far, currentPeriodEndsAt: far }, t0)).toMatchObject({ level: "locked", reason: "suspended" });
    expect(accessOf({ status: "cancelled", trialEndsAt: far, currentPeriodEndsAt: far }, t0)).toMatchObject({ level: "locked", reason: "cancelled" });
  });
});

describe("batas paket", () => {
  it("paket dikenal dengan timpaan per bisnis; paket tak dikenal tidak mengunci", () => {
    expect(limitsOf("basic")).toEqual(planLimits.basic);
    expect(limitsOf("basic", { maxOutlets: 4 })).toMatchObject({ maxOutlets: 4, maxDevices: planLimits.basic.maxDevices });
    expect(limitsOf("tidak-ada").maxOutlets).toBe(Number.MAX_SAFE_INTEGER);
    expect(limitsOf("unlimited", null).maxDevices).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("periode berikutnya setelah pembayaran", () => {
  it("bulanan dan tahunan; tidak ada hari hilang saat bayar lebih awal", () => {
    expect(nextPeriodEnd("monthly", null, new Date("2026-03-10T00:00:00Z")).toISOString()).toBe("2026-04-10T00:00:00.000Z");
    expect(nextPeriodEnd("yearly", null, new Date("2026-03-10T00:00:00Z")).toISOString()).toBe("2027-03-10T00:00:00.000Z");
    // bayar 5 hari sebelum habis: periode baru dihitung dari akhir periode lama
    const now = new Date("2026-03-05T00:00:00Z");
    expect(nextPeriodEnd("monthly", new Date("2026-03-10T00:00:00Z"), now).toISOString()).toBe("2026-04-10T00:00:00.000Z");
    // sudah lewat: dihitung dari sekarang
    expect(nextPeriodEnd("monthly", new Date("2026-02-01T00:00:00Z"), now).toISOString()).toBe("2026-04-05T00:00:00.000Z");
  });
  it("akhir bulan tidak melompat ke bulan berikutnya", () => {
    expect(nextPeriodEnd("monthly", null, new Date("2026-01-31T00:00:00Z")).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(nextPeriodEnd("yearly", null, new Date("2028-02-29T00:00:00Z")).toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});
