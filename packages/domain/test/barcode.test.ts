import { describe, expect, it } from "vitest";
import { ScanDetector, barcodeProblem, ean13CheckDigit, isValidEan13 } from "../src";

describe("EAN-13", () => {
  it("digit pemeriksa dan validasi pada contoh nyata", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("8992761111113")).toBe(true); // Indonesia (899)
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("400638133393")).toBe(false); // 12 digit
    expect(isValidEan13("40063813339A1")).toBe(false);
  });
});

describe("barcodeProblem", () => {
  it("menerima EAN-13 sah dan kode buatan sendiri", () => {
    expect(barcodeProblem("4006381333931")).toBeNull();
    expect(barcodeProblem("KOPI-001")).toBeNull();
    expect(barcodeProblem("12345")).toBeNull();
    expect(barcodeProblem("A/B_c.9")).toBeNull();
  });
  it("menolak salah ketik EAN-13, spasi, kosong, dan terlalu panjang", () => {
    expect(barcodeProblem("4006381333932")).toBe("ean13_checksum");
    expect(barcodeProblem("KODE 1")).toBe("charset");
    expect(barcodeProblem("kopié")).toBe("charset");
    expect(barcodeProblem("")).toBe("empty");
    expect(barcodeProblem("x".repeat(65))).toBe("length");
  });
});

describe("ScanDetector", () => {
  const type = (d: ScanDetector, text: string, start: number, gap: number, enter = true) => {
    let t = start;
    for (const ch of text) {
      d.key(ch, t);
      t += gap;
    }
    return enter ? d.key("Enter", t) : null;
  };

  it("mengenali deretan cepat yang diakhiri Enter sebagai scan", () => {
    expect(type(new ScanDetector(), "8992761111113", 1000, 8)).toBe("8992761111113");
  });
  it("mengetik manual (lambat) bukan scan", () => {
    expect(type(new ScanDetector(), "8992761111113", 1000, 120)).toBeNull();
  });
  it("kode terlalu pendek bukan scan", () => {
    expect(type(new ScanDetector(), "12", 1000, 5)).toBeNull();
  });
  it("jeda panjang di tengah memulai ulang deretan (hanya ekor cepat yang dihitung)", () => {
    const d = new ScanDetector();
    d.key("a", 0);
    d.key("b", 10);
    expect(type(d, "XYZ99", 1000, 5)).toBe("XYZ99");
  });
  it("Enter tanpa deretan tidak menghasilkan apa-apa, dan dua scan berturut-turut terpisah", () => {
    const d = new ScanDetector();
    expect(d.key("Enter", 0)).toBeNull();
    expect(type(d, "AAA111", 100, 5)).toBe("AAA111");
    expect(type(d, "BBB222", 400, 5)).toBe("BBB222");
  });
  it("tombol non-karakter (Shift) tidak memutus deretan", () => {
    const d = new ScanDetector();
    d.key("K", 0);
    d.key("Shift", 4);
    d.key("O", 8);
    d.key("P", 12);
    expect(d.key("Enter", 16)).toBe("KOP");
  });
});
