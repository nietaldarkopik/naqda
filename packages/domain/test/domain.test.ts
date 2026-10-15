import { describe, expect, it } from "vitest";
import {
  formatMoney,
  hasAppAccess,
  hasBackofficeAccess,
  quickCashAmounts,
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

describe("quickCashAmounts (tombol uang tunai cepat)", () => {
  it("rupiah: tagihan pas lalu pembulatan ke pecahan umum", () => {
    expect(quickCashAmounts(62370, "IDR", 0)).toEqual([62370, 65000, 70000, 80000, 100000]);
    expect(quickCashAmounts(100000, "IDR", 0)).toEqual([100000]); // sudah pas di pecahan terbesar: tak ada saran lain
  });
  it("dolar (2 desimal): pecahan dalam dolar, bukan ribuan dolar", () => {
    // 12,37 dolar = 1237 sen
    expect(quickCashAmounts(1237, "USD", 2)).toEqual([1237, 1300, 1500, 2000, 5000]);
    expect(Math.max(...quickCashAmounts(1237, "USD", 2))).toBeLessThanOrEqual(10_000);
  });
  it("euro dan yen memakai pecahannya sendiri", () => {
    expect(quickCashAmounts(1237, "EUR", 2)).toEqual([1237, 1500, 2000, 5000, 10000]);
    expect(quickCashAmounts(2350, "JPY", 0)).toEqual([2350, 3000, 4000, 5000, 10000]);
  });
  it("mata uang yang belum terdaftar memakai deret generik berskala tagihan", () => {
    const q = quickCashAmounts(4500, "XYZ", 2); // 45,00
    expect(q[0]).toBe(4500);
    expect(q.every((v, i) => i === 0 || v > q[i - 1]!)).toBe(true);
    expect(q.length).toBeGreaterThan(2);
    expect(q.at(-1)!).toBeLessThanOrEqual(20_000); // tidak melompat ke ribuan satuan utama
  });
  it("tanpa duplikat, selalu naik, dan dipotong sesuai max; total 0 aman", () => {
    const q = quickCashAmounts(62370, "IDR", 0, 3);
    expect(q).toEqual([62370, 65000, 70000]);
    expect(new Set(q).size).toBe(3);
    expect(quickCashAmounts(0, "IDR", 0)).toEqual([0]);
  });
});
