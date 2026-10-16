/**
 * Mengubah gambar berwarna (RGBA, hasil canvas) menjadi bitmap hitam-putih 1-bit untuk printer termal.
 * Murni (tanpa DOM): dipakai web, desktop, dan mobile, dan bisa diuji tanpa perangkat.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 byte per piksel, baris demi baris. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface MonoBitmap {
  width: number;
  height: number;
  bytesPerRow: number;
  /** 1 = titik hitam (dicetak). Bit paling kiri = bit paling berarti (MSB) tiap byte, sesuai GS v 0. */
  bits: Uint8Array;
}

export interface MonoOptions {
  /** Kecerahan (0-255) di bawah ini dianggap hitam. Bawaan 160: cenderung menebalkan teks kecil agar terbaca di kertas termal. */
  threshold?: number;
  /** Floyd-Steinberg untuk gambar berarsir (logo, foto). Teks struk tidak membutuhkannya dan lebih tajam tanpa dither. */
  dither?: boolean;
}

/** Kecerahan 0-255; piksel transparan dianggap putih (kertas), bukan hitam. */
const luminance = (r: number, g: number, b: number, a: number): number => {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return 255 - ((255 - lum) * a) / 255;
};

export const rgbaToMono = (img: RgbaImage, options: MonoOptions = {}): MonoBitmap => {
  const { width, height, data } = img;
  if (data.length < width * height * 4) throw new Error("data gambar lebih pendek dari ukuran yang dinyatakan");
  const threshold = options.threshold ?? 160;
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);

  // Dither memakai salinan kecerahan (Float32) agar galat bisa menyebar ke tetangga.
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) lum[i] = luminance(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const old = lum[idx]!;
      const black = old < threshold;
      if (black) bits[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
      if (options.dither) {
        const err = old - (black ? 0 : 255);
        if (x + 1 < width) lum[idx + 1]! += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) lum[idx + width - 1]! += (err * 3) / 16;
          lum[idx + width]! += (err * 5) / 16;
          if (x + 1 < width) lum[idx + width + 1]! += err / 16;
        }
      }
    }
  }
  return { width, height, bytesPerRow, bits };
};

/** Memotong baris putih di bawah struk agar kertas tidak terbuang; menyisakan `keep` baris. */
export const trimBottom = (bmp: MonoBitmap, keep = 8): MonoBitmap => {
  let last = bmp.height - 1;
  while (last >= 0) {
    let blank = true;
    for (let i = 0; i < bmp.bytesPerRow; i++) {
      if (bmp.bits[last * bmp.bytesPerRow + i] !== 0) {
        blank = false;
        break;
      }
    }
    if (!blank) break;
    last--;
  }
  const height = Math.min(bmp.height, Math.max(1, last + 1 + keep));
  return { ...bmp, height, bits: bmp.bits.slice(0, height * bmp.bytesPerRow) };
};
