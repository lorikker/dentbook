import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next 16: the middleware convention is renamed to proxy (Node runtime).
// next-intl's handler is a plain request handler, so it works unchanged.
const handle = createMiddleware(routing);

export default function proxy(request: Parameters<typeof handle>[0]) {
  return handle(request);
}

export const config = {
  // Everything except api, static files, images — and the Pages Router
  // routes under src/pages/ (products, favorites), which are intentionally
  // English-only and not part of next-intl's [locale] routing. Without this
  // exclusion, next-intl rewrites these unprefixed paths and they 404.
  matcher: ["/((?!api|_next|products|favorites|.*\\..*).*)"],
};
