import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Alamat API yang dipanggil dari server Next (bukan dari browser). Bawaan: 127.0.0.1, tanpa nama host Docker.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  // Paket bersama (i18n, domain) berada di luar apps/web.
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  async rewrites() {
    // Browser selalu memanggil /api/v1 pada asal yang sama, sehingga cookie sesi (SameSite=Lax) ikut terkirim.
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
};

export default withNextIntl(config);
