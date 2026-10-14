import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Penyimpanan berkas di balik antarmuka kecil. Driver `local` menulis ke folder; driver S3 belum ada
 * (STORAGE_DRIVER=s3 ditolak saat start agar tidak diam-diam menulis ke tempat yang salah).
 */
export interface Storage {
  save(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
}

const safeKey = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

export const localStorageDriver = (rootDir: string): Storage => {
  const root = path.resolve(rootDir);
  const resolve = (key: string) => {
    if (!safeKey.test(key)) throw new Error("kunci berkas tidak valid");
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("kunci berkas keluar dari folder penyimpanan");
    return full;
  };
  return {
    async save(key, bytes) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
    },
    async read(key) {
      try {
        return await readFile(resolve(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
};

export type ImageType = { ext: "png" | "jpg" | "webp"; mime: string };

/** Mengenali gambar dari byte awal (bukan dari nama berkas atau header klien). */
export const sniffImage = (b: Uint8Array): ImageType | null => {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
};

export const mimeForExt = (ext: string): string => (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
