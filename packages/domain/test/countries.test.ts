import { describe, expect, it } from "vitest";
import { countries, countryInfo, guessCountry, isSupportedCurrency } from "../src";

describe("negara untuk pendaftaran", () => {
  it("kode unik, mata uang didukung, zona waktu IANA sah, bahasa dikenal", () => {
    expect(new Set(countries.map((c) => c.code)).size).toBe(countries.length);
    for (const c of countries) {
      expect(c.code, c.code).toMatch(/^[A-Z]{2}$/);
      expect(isSupportedCurrency(c.currency), `${c.code} ${c.currency}`).toBe(true);
      expect(() => new Intl.DateTimeFormat("en", { timeZone: c.timezone }), `${c.code} ${c.timezone}`).not.toThrow();
      expect(["id", "en", "ar"]).toContain(c.locale);
    }
  });
  it("kode wilayah dikenali Intl (mencegah salah kode)", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const c of countries) expect(names.of(c.code), c.code).not.toBe(c.code);
  });
  it("negara bawaan: Indonesia rupiah, Saudi riyal, Amerika dolar", () => {
    expect(countryInfo("id")).toMatchObject({ currency: "IDR", timezone: "Asia/Jakarta", locale: "id" });
    expect(countryInfo("SA")).toMatchObject({ currency: "SAR", locale: "ar" });
    expect(countryInfo("US")).toMatchObject({ currency: "USD" });
    expect(countryInfo("ZZ")).toBeUndefined();
  });
  it("menebak negara dari zona waktu peramban", () => {
    expect(guessCountry("Asia/Riyadh")?.code).toBe("SA");
    expect(guessCountry("Asia/Jakarta")?.code).toBe("ID");
    expect(guessCountry("Antarctica/Troll")).toBeNull();
  });
});
