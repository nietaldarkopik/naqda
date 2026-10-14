import { describe, expect, it } from "vitest";
import {
  formatMoney,
  hasAppAccess,
  hasBackofficeAccess,
  isPrivilege,
  privileges,
  roundTo,
  systemRoles,
  toMinor,
} from "../src/index";

describe("uang", () => {
  it("pembulatan ke kelipatan, titik tengah ke atas", () => {
    expect(roundTo(10449, 100)).toBe(10400);
    expect(roundTo(10450, 100)).toBe(10500);
    expect(roundTo(10000, 1000)).toBe(10000);
    expect(roundTo(10500, 1000)).toBe(11000);
  });

  it("menolak nilai bukan integer", () => {
    expect(() => roundTo(10.5, 100)).toThrow(RangeError);
    expect(() => roundTo(100, 0)).toThrow(RangeError);
  });

  it("konversi satuan terkecil mengikuti exponent", () => {
    expect(toMinor(12500, 0)).toBe(12500);
    expect(toMinor(12.5, 2)).toBe(1250);
    expect(toMinor(0.1 + 0.2, 2)).toBe(30);
  });

  it("format rupiah tanpa desimal", () => {
    const text = formatMoney(125000, 0, "IDR", "id-ID");
    expect(text.replace(/\s/g, "")).toBe("Rp125.000");
  });
});

describe("hak akses", () => {
  it("setiap hak akses peran bawaan valid", () => {
    for (const role of systemRoles) for (const p of role.privileges) expect(isPrivilege(p)).toBe(true);
  });

  it("administrator memegang semua hak akses", () => {
    const admin = systemRoles.find((r) => r.key === "administrator");
    expect([...(admin?.privileges ?? [])].sort()).toEqual([...privileges].sort());
  });

  it("kasir hanya aplikasi, investor hanya back office", () => {
    const cashier = systemRoles.find((r) => r.key === "cashier")!;
    const investor = systemRoles.find((r) => r.key === "investor")!;
    expect(hasBackofficeAccess(cashier.accessType)).toBe(false);
    expect(hasAppAccess(cashier.accessType)).toBe(true);
    expect(hasAppAccess(investor.accessType)).toBe(false);
    expect(hasBackofficeAccess(investor.accessType)).toBe(true);
  });
});
