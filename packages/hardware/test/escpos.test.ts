import { describe, expect, it } from "vitest";
import { chunk, concat, cut, dotsForPaper, feed, openDrawer, rasterBands, receiptJob, rgbaToMono, trimBottom, type MonoBitmap } from "../src";

const rgba = (w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];

describe("rgbaToMono", () => {
  it("hitam menjadi bit 1, putih bit 0, MSB di kiri", () => {
    const bmp = rgbaToMono(rgba(8, 1, (x) => (x === 0 || x === 7 ? BLACK : WHITE)));
    expect(bmp.bytesPerRow).toBe(1);
    expect(bmp.bits[0]).toBe(0b10000001);
  });

  it("lebar bukan kelipatan 8: baris dibulatkan ke atas dan sisa bit nol", () => {
    const bmp = rgbaToMono(rgba(10, 2, () => BLACK));
    expect(bmp.bytesPerRow).toBe(2);
    expect([...bmp.bits]).toEqual([0xff, 0b11000000, 0xff, 0b11000000]);
  });

  it("piksel transparan dianggap kertas putih, bukan hitam", () => {
    const bmp = rgbaToMono(rgba(8, 1, () => [0, 0, 0, 0]));
    expect(bmp.bits[0]).toBe(0);
  });

  it("ambang menentukan abu-abu: gelap tercetak, terang tidak", () => {
    const dark = rgbaToMono(rgba(8, 1, () => [100, 100, 100, 255]));
    const light = rgbaToMono(rgba(8, 1, () => [200, 200, 200, 255]));
    expect(dark.bits[0]).toBe(0xff);
    expect(light.bits[0]).toBe(0);
    expect(rgbaToMono(rgba(8, 1, () => [200, 200, 200, 255]), { threshold: 220 }).bits[0]).toBe(0xff);
  });

  it("dither menghasilkan campuran titik untuk abu-abu tengah (tanpa dither: seragam)", () => {
    const grey = rgba(16, 16, () => [128, 128, 128, 255]);
    const count = (b: MonoBitmap) => [...b.bits].reduce((n, v) => n + v.toString(2).replace(/0/g, "").length, 0);
    const plain = count(rgbaToMono(grey, { threshold: 128 }));
    const dithered = count(rgbaToMono(grey, { threshold: 128, dither: true }));
    expect(plain === 0 || plain === 16 * 16).toBe(true);
    expect(dithered).toBeGreaterThan(60);
    expect(dithered).toBeLessThan(200);
  });

  it("data lebih pendek dari ukuran ditolak", () => {
    expect(() => rgbaToMono({ width: 8, height: 2, data: new Uint8Array(10) })).toThrow();
  });
});

describe("trimBottom", () => {
  it("membuang baris putih di bawah, menyisakan sedikit", () => {
    const bmp = rgbaToMono(rgba(8, 20, (_x, y) => (y < 3 ? BLACK : WHITE)));
    const t = trimBottom(bmp, 2);
    expect(t.height).toBe(5);
    expect(t.bits.length).toBe(5);
  });
  it("gambar kosong tidak menjadi tinggi nol", () => {
    expect(trimBottom(rgbaToMono(rgba(8, 5, () => WHITE)), 0).height).toBe(1);
  });
});

describe("ESC/POS", () => {
  it("lebar cetak kelipatan 8 untuk kedua kertas", () => {
    expect(dotsForPaper(58)).toBe(384);
    expect(dotsForPaper(80)).toBe(576);
    expect(dotsForPaper(58) % 8).toBe(0);
    expect(dotsForPaper(80) % 8).toBe(0);
  });

  it("perintah dasar: maju, potong, laci", () => {
    expect([...feed(4)]).toEqual([0x1b, 0x64, 4]);
    expect([...feed(999)]).toEqual([0x1b, 0x64, 255]);
    expect([...cut(0)]).toEqual([0x1d, 0x56, 66, 0]);
    expect([...openDrawer()]).toEqual([0x1b, 0x70, 0, 50, 250]);
  });

  it("raster dipecah per pita dengan header GS v 0 yang benar", () => {
    const bmp = rgbaToMono(rgba(16, 300, () => BLACK));
    const bands = rasterBands(bmp, 128);
    expect(bands).toHaveLength(3); // 128 + 128 + 44
    expect([...bands[0]!.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 128, 0]);
    expect([...bands[2]!.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 44, 0]);
    // isi seluruhnya ada: 8 byte header + bytesPerRow * baris
    expect(bands.reduce((n, b) => n + b.length, 0)).toBe(3 * 8 + 2 * 300);
    expect(() => rasterBands(bmp, 0)).toThrow();
    expect(() => rasterBands(bmp, 256)).toThrow();
  });

  it("lebar penuh 80 mm: bytesPerRow 72 dikodekan xL/xH", () => {
    const bmp = rgbaToMono(rgba(576, 1, () => BLACK));
    const [band] = rasterBands(bmp);
    expect([...band!.subarray(4, 6)]).toEqual([72, 0]);
  });

  it("pekerjaan struk berurutan: init, gambar, maju, potong, laci opsional", () => {
    const bmp = rgbaToMono(rgba(8, 4, () => BLACK));
    const job = receiptJob(bmp, { feedLines: 5, openDrawer: true });
    const flat = concat(...job);
    expect([...flat.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect(flat.slice(-5)).toEqual(openDrawer());
    const noCut = concat(...receiptJob(bmp, { cut: false }));
    expect(noCut.length).toBeLessThan(flat.length);
    // tanpa laci: berakhir di perintah potong
    expect([...concat(...receiptJob(bmp)).slice(-4)]).toEqual([0x1d, 0x56, 66, 0]);
  });

  it("chunk memecah byte tanpa kehilangan isi", () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    const parts = chunk(data, 180);
    expect(parts).toHaveLength(6);
    expect(parts.every((p) => p.length <= 180)).toBe(true);
    expect(concat(...parts)).toEqual(data);
    expect(() => chunk(data, 0)).toThrow();
  });
});
