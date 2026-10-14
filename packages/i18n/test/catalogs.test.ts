import { describe, expect, it } from "vitest";
import { catalogs, flattenKeys, localeDir, locales, translate } from "../src/index";

describe("katalog terjemahan", () => {
  const base = flattenKeys(catalogs.id).sort();

  for (const locale of locales) {
    it(`${locale} memiliki kunci yang sama dengan id`, () => {
      expect(flattenKeys(catalogs[locale]).sort()).toEqual(base);
    });

    it(`${locale} tidak punya nilai kosong`, () => {
      const empties = flattenKeys(catalogs[locale]).filter((key) => translate(locale, key).trim() === "");
      expect(empties).toEqual([]);
    });
  }

  it("placeholder {nama} sama di semua bahasa", () => {
    const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const key of base) {
      const expected = tokens(translate("id", key));
      for (const locale of locales) expect(tokens(translate(locale, key)), `${locale}:${key}`).toBe(expected);
    }
  });

  it("arah teks: hanya Arab RTL", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("id")).toBe("ltr");
    expect(localeDir("en")).toBe("ltr");
  });

  it("translate mengisi parameter dan jatuh ke kunci bila tidak ada", () => {
    expect(translate("en", "common.page", { page: 2, total: 5 })).toBe("Page 2 of 5");
    expect(translate("id", "tidak.ada")).toBe("tidak.ada");
  });
});
