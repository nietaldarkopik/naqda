"use client";

import { dotsForPaper, receiptJob, rgbaToMono, trimBottom, type PaperMm, type ReceiptJobOptions } from "@naqdi/hardware";

/**
 * Menggambar struk di layar (elemen DOM ReceiptView) menjadi pekerjaan cetak ESC/POS. Yang dicetak SAMA dengan yang terlihat,
 * termasuk huruf Arab, logo, dan font apa pun, karena printer hanya menerima gambar. html-to-image dimuat malas.
 */
export const renderReceiptJob = async (el: HTMLElement, paperMm: PaperMm, options: ReceiptJobOptions = {}): Promise<Uint8Array[]> => {
  const { toCanvas } = await import("html-to-image");
  const dots = dotsForPaper(paperMm);
  const width = Math.max(1, el.offsetWidth);
  // Skala agar lebar hasil = jumlah titik printer; font kecil tetap tajam karena digambar ulang pada resolusi printer.
  const source = await toCanvas(el, { pixelRatio: dots / width, backgroundColor: "#ffffff", cacheBust: true });
  // Pembulatan pixelRatio bisa meleset 1-2 piksel dari lebar printer: gambar ulang tepat selebar `dots`.
  const out = document.createElement("canvas");
  out.width = dots;
  out.height = Math.max(1, Math.round((source.height * dots) / source.width));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas tidak tersedia");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0, out.width, out.height);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const mono = trimBottom(rgbaToMono({ width: image.width, height: image.height, data: image.data }));
  return receiptJob(mono, options);
};

/** Struk uji: Latin, Arab, dan angka, digambar langsung di canvas (tanpa elemen DOM) untuk memeriksa printer dan lebar kertas. */
export const renderTestJob = async (paperMm: PaperMm): Promise<Uint8Array[]> => {
  const dots = dotsForPaper(paperMm);
  const canvas = document.createElement("canvas");
  canvas.width = dots;
  canvas.height = 260;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas tidak tersedia");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dots, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText("Naqdi", dots / 2, 56);
  ctx.font = "28px sans-serif";
  ctx.fillText(`Tes cetak ${paperMm} mm`, dots / 2, 104);
  ctx.fillText("Rp 18.000  ·  1.234.567", dots / 2, 148);
  ctx.direction = "rtl";
  ctx.fillText("اختبار الطباعة ٠١٢٣٤٥٦٧٨٩", dots / 2, 192);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, dots - 4, canvas.height - 4);
  const image = ctx.getImageData(0, 0, dots, canvas.height);
  return receiptJob(rgbaToMono({ width: image.width, height: image.height, data: image.data }));
};
