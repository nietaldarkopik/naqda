import { describe, expect, it } from "vitest";
import { CsvError, detectDelimiter, parseCsv, parseCsvTable, percentOf, priceFor, toCsv } from "../src/index";

describe("csv", () => {
  it("mem-parse sel sederhana dan CRLF/LF", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("menangani kutip, koma, kutip ganda, dan baris baru di dalam sel", () => {
    expect(parseCsv('"a,b","say ""hi""","l1\nl2"\n')).toEqual([["a,b", 'say "hi"', "l1\nl2"]]);
  });

  it("mengabaikan BOM dan baris kosong", () => {
    expect(parseCsv("﻿x,y\n\n1,2\n")).toEqual([["x", "y"], ["1", "2"]]);
  });

  it("mengenali titik koma (Excel Indonesia) dan tab", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(detectDelimiter("a\tb")).toBe("\t");
    expect(detectDelimiter("satu")).toBe(",");
  });

  it("pemisah di dalam kutip tidak dihitung saat deteksi", () => {
    expect(detectDelimiter('"a;b;c",d,e')).toBe(",");
  });

  it("menolak kutip tidak tertutup dan kutip di tengah sel", () => {
    expect(() => parseCsv('"abc')).toThrow(CsvError);
    expect(() => parseCsv('ab"c",d')).toThrow(CsvError);
  });

  it("toCsv lalu parseCsv menghasilkan data yang sama", () => {
    const rows = [["nama", "catatan"], ["Kopi, susu", 'dia bilang "enak"'], ["Teh", "baris1\nbaris2"], ["x", ""]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("toCsv menetralkan awalan rumus tetapi tidak angka negatif", () => {
    expect(toCsv([["=1+1", "-5", "@x", "+62"]])).toBe("'=1+1,-5,'@x,+62");
  });

  it("parseCsvTable memberi nomor baris asli dan huruf kecil pada header", () => {
    const t = parseCsvTable("Name,Price\nKopi,1000\nTeh,2000");
    expect(t).toEqual([
      { line: 2, values: { name: "Kopi", price: "1000" } },
      { line: 3, values: { name: "Teh", price: "2000" } },
    ]);
  });
});

describe("harga", () => {
  const variant = { basePrice: 20000, prices: { grab: 25000 } };

  it("memakai harga khusus bila ada, selain itu harga dasar", () => {
    expect(priceFor(variant, "grab")).toBe(25000);
    expect(priceFor(variant, "dinein")).toBe(20000);
    expect(priceFor(variant, null)).toBe(20000);
  });

  it("harga khusus 0 tetap dipakai (bukan dianggap kosong)", () => {
    expect(priceFor({ basePrice: 100, prices: { free: 0 } }, "free")).toBe(0);
  });

  it("persen dari uang dibulatkan setengah ke atas", () => {
    expect(percentOf(10000, 1000)).toBe(1000);
    expect(percentOf(15, 1000)).toBe(2);
    expect(percentOf(14, 1000)).toBe(1);
  });
});
