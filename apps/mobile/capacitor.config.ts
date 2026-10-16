import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Aplikasi Android kasir Naqdi = pembungkus WebView yang memuat kasir (/pos) dari server. Kode kasir ada di apps/web, jadi
 * pembaruan fitur tidak perlu merilis ulang APK. Offline: service worker kasir menyimpan halaman dan katalog setelah pemuatan
 * pertama (butuh internet sekali), lalu penjualan berjalan tanpa internet dan disinkronkan nanti.
 *
 * Alamat server dapat diganti saat sinkronisasi: NAQDI_URL=https://alamat-anda npm run sync
 * `appId` BERSIFAT PERMANEN setelah rilis di Google Play: tetapkan sebelum unggahan pertama (lihat docs/08-mobile.md).
 */
const origin = (process.env.NAQDI_URL ?? "https://naqdi.excoder.site").replace(/\/+$/, "");
const host = new URL(origin).host;

const config: CapacitorConfig = {
  appId: "id.naqdi.kasir",
  appName: "Naqdi Kasir",
  webDir: "www",
  backgroundColor: "#ffffff",
  server: {
    url: `${origin}/id/pos`,
    // HTTP polos hanya untuk uji di jaringan lokal; produksi wajib HTTPS (service worker offline tidak jalan di HTTP).
    cleartext: origin.startsWith("http://"),
    allowNavigation: [host],
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: process.env.NAQDI_DEBUG === "1",
  },
};

export default config;
