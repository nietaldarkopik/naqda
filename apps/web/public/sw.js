/*
 * Service Worker kasir Naqdi. Tujuannya satu: halaman kasir (/id|en|ar/pos) dan aset aplikasinya tetap bisa dibuka
 * tanpa internet, setelah pernah dibuka sekali saat online.
 *
 * - API (/api/) TIDAK PERNAH disimpan di sini. Data katalog/harga offline disimpan oleh aplikasi di IndexedDB.
 * - Halaman kasir: jaringan dulu (agar pembaruan langsung terpakai), salinan terakhir bila jaringan gagal.
 * - Aset /_next/static/ (nama berkas memuat hash isi): salinan dulu, selamanya valid.
 */
const VERSION = "v2";
const PAGES = `naqdi-pages-${VERSION}`;
const ASSETS = `naqdi-assets-${VERSION}`;
const POS_PAGE = /^\/(id|en|ar)\/pos\/?$/;
const NETWORK_TIMEOUT_MS = 5000;
// Berkas merek kecil yang tampil di layar kasir: disimpan agar tidak menjadi gambar rusak saat offline.
const BRAND_FILES = new Set(["/logo.png", "/icon-192.png", "/icon-512.png"]);

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("naqdi-") && key !== PAGES && key !== ASSETS) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

const pageKey = (url) => url.origin + url.pathname.replace(/\/$/, "");

async function networkFirstPage(request, url) {
  const cache = await caches.open(PAGES);
  try {
    const response = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS))]);
    if (response.ok) await cache.put(pageKey(url), response.clone());
    return response;
  } catch {
    const hit = (await cache.match(pageKey(url))) || (await anyCachedPage(cache));
    return hit || new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

async function anyCachedPage(cache) {
  for (const request of await cache.keys()) return cache.match(request);
  return undefined;
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && POS_PAGE.test(url.pathname)) {
    event.respondWith(networkFirstPage(request, url));
  } else if (url.pathname.startsWith("/_next/static/") || BRAND_FILES.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

// Pada kunjungan pertama, halaman dan asetnya dimuat sebelum Service Worker aktif. Aplikasi mengirim daftar URL
// yang sudah dimuat supaya ikut disimpan (diambil dari cache HTTP browser, bukan unduhan baru).
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "cache-urls" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    (async () => {
      for (const raw of event.data.urls) {
        try {
          const url = new URL(raw, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          const isPage = POS_PAGE.test(url.pathname);
          if (!isPage && !url.pathname.startsWith("/_next/static/") && !BRAND_FILES.has(url.pathname)) continue;
          const cache = await caches.open(isPage ? PAGES : ASSETS);
          const key = isPage ? pageKey(url) : url.href;
          if (await cache.match(key)) continue;
          const response = await fetch(isPage ? new Request(key) : url.href, { credentials: "same-origin" });
          if (response.ok) await cache.put(key, response);
        } catch {
          /* satu URL gagal tidak menghentikan yang lain */
        }
      }
    })(),
  );
});
