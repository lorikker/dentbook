import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next 16: the middleware convention is renamed to proxy (Node runtime).
// next-intl's handler is a plain request handler, so it works unchanged.
const handle = createMiddleware(routing);

export default function proxy(request: Parameters<typeof handle>[0]) {
  return handle(request);
}

export const config = {
  // everything except api, static files, images
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
