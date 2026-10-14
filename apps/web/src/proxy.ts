import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16: berkas ini menggantikan middleware.ts. Mengarahkan "/" ke bahasa yang sesuai.
export default createMiddleware(routing);

export const config = {
  // Lewati API, aset Next, dan berkas statis.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
