import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { auth } from "@/auth";
import { routing } from "./i18n/routing";

// Next 16: the middleware convention is renamed to proxy (Node runtime).
// next-intl's handler is a plain request handler, so it works unchanged.
const handleIntl = createMiddleware(routing);

// Optimistic, session-only gate: bounces anonymous visitors before a page
// even renders. This is deliberately NOT the authoritative check — Next's
// own guidance is that proxy "should not be used as a full session
// management or authorization solution." The real, DB-backed checks
// (staff membership via requireStaff(), the isPlatformAdmin flag via
// requirePlatformAdmin(), the inline check on /profile) still run in each
// page and remain the actual gate; this only saves an anonymous visitor a
// full render + DB round-trip for a page they can't use anyway.
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/profile"];

/** Strips a next-intl locale prefix (if present) from a pathname. */
function stripLocale(pathname: string): { locale: string; rest: string } {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue; // ships with no prefix
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return { locale, rest: pathname.slice(locale.length + 1) || "/" };
    }
  }
  return { locale: routing.defaultLocale, rest: pathname };
}

export default auth((request) => {
  const { pathname } = request.nextUrl;

  // /favorites is the Pages Router route — intentionally English-only and
  // outside next-intl's [locale] routing (see the matcher note below), so
  // it's handled directly here instead of falling through to handleIntl.
  if (pathname === "/favorites") {
    return request.auth
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const { locale, rest } = stripLocale(pathname);
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => rest === p || rest.startsWith(`${p}/`),
  );
  if (isProtected && !request.auth) {
    const loginPath = locale === routing.defaultLocale ? "/login" : `/${locale}/login`;
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  return handleIntl(request);
});

export const config = {
  // Everything except api, static files, images — and the Pages Router
  // routes under src/pages/ (products), which are intentionally
  // English-only and not part of next-intl's [locale] routing. Without this
  // exclusion, next-intl rewrites these unprefixed paths and they 404.
  // (favorites is included so the auth check above still runs for it.)
  matcher: ["/((?!api|_next|products|.*\\..*).*)"],
};
