import { describe, expect, it } from "vitest";
import { currencyInfo, exponentOf, formatMoney, isSupportedCurrency, quickCashAmounts, supportedCurrencies, toMinor } from "../src";

describe("katalog mata uang", () => {
  it("exponent tiap mata uang sama dengan ISO 4217 menurut Intl (mencegah salah tabel)", () => {
    for (const { code, exponent } of supportedCurrencies) {
      const iso = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
      expect(exponent, code).toBe(iso);
    }
  });
  it("tanpa kode ganda; rupiah 0, dolar dan riyal 2, dinar 3", () => {
    expect(new Set(supportedCurrencies.map((c) => c.code)).size).toBe(supportedCurrencies.length);
    expect(exponentOf("IDR")).toBe(0);
    for (const c of ["USD", "SGD", "AUD", "CAD", "NZD", "HKD", "SAR", "AED"]) expect(exponentOf(c), c).toBe(2);
    for (const c of ["KWD", "BHD", "OMR"]) expect(exponentOf(c), c).toBe(3);
  });
  it("huruf kecil diterima; kode tidak dikenal ditolak", () => {
    expect(currencyInfo("sar")?.exponent).toBe(2);
    expect(isSupportedCurrency("XXX")).toBe(false);
    expect(() => exponentOf("XXX")).toThrow();
  });
});

describe("format uang per mata uang dan bahasa", () => {
  const f = (minor: number, code: string, tag: string) => formatMoney(minor, exponentOf(code), code, tag).replace(/[  ‏‎]/g, " ").trim();

  it("rupiah selalu bergaya Indonesia, juga di antarmuka Inggris dan Arab", () => {
    expect(f(18000, "IDR", "id-ID")).toBe("Rp 18.000");
    expect(f(18000, "IDR", "en-US")).toBe("Rp 18.000");
    expect(f(1250000, "IDR", "ar-u-nu-latn")).toBe("Rp 1.250.000");
    expect(f(0, "IDR", "en-US")).toBe("Rp 0");
  });
  it("dolar: tepat dua desimal dalam sen", () => {
    expect(f(1237, "USD", "en-US")).toBe("$12.37");
    expect(f(5, "USD", "en-US")).toBe("$0.05");
    expect(f(1237, "USD", "id-ID")).toBe("US$12,37");
    expect(f(1237, "AUD", "en-US")).toBe("A$12.37");
    expect(f(1237, "CAD", "en-US")).toBe("CA$12.37");
    expect(f(1237, "SGD", "en-US")).toBe("SGD 12.37");
    expect(f(1237, "NZD", "en-US")).toBe("NZ$12.37");
  });
  it("riyal Saudi: dua desimal (halala); Arab memakai simbol riyal dan digit Latin", () => {
    expect(f(1250, "SAR", "en-US")).toBe("SAR 12.50");
    expect(f(1250, "SAR", "id-ID")).toBe("SAR 12,50");
    expect(f(1250, "SAR", "ar-u-nu-latn")).toBe("12.50 ر.س.");
    expect(f(99, "SAR", "en-US")).toBe("SAR 0.99");
  });
  it("tiga desimal (dinar) dan nol desimal (yen)", () => {
    expect(f(12500, "KWD", "en-US")).toBe("KWD 12.500");
    expect(f(1237, "JPY", "en-US")).toBe("¥1,237");
  });
  it("nilai besar tidak kehilangan presisi di format", () => {
    expect(f(99_999_999_99, "USD", "en-US")).toBe("$99,999,999.99");
  });
});

describe("uang tunai cepat per mata uang pilihan", () => {
  it("SAR dan dolar lain memakai pecahan sendiri, bukan rupiah", () => {
    expect(quickCashAmounts(1237, "SAR", 2)).toEqual([1237, 1500, 2000, 5000, 10000]);
    expect(quickCashAmounts(1237, "HKD", 2).every((v) => v < 100_000)).toBe(true);
    expect(quickCashAmounts(toMinor(8.5, 3), "KWD", 3).length).toBeGreaterThan(1);
  });
});
