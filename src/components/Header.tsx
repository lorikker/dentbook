import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { countFavorites } from "@/lib/favorites";
import { ToothIcon } from "@/components/ToothIcon";

function initialsOf(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

const navLinkClass =
  "px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-cream";

export async function Header() {
  // The Header renders on every route, so its waterfall is on every page's
  // critical path. Session and translations are independent — only the
  // favourites count actually depends on the session.
  const [session, t] = await Promise.all([auth(), getTranslations("Header")]);
  const favCount = session?.user?.kind === "patient"
    ? await countFavorites({ userId: session.user.id })
    : 0;

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center gap-8 border-b border-ink-line bg-ink px-8">
      <Link href="/" className="flex items-center gap-2.5 text-cream">
        <span className="grid h-7.5 w-7.5 place-items-center bg-cream text-ink">
          <ToothIcon className="h-4.5 w-4.5" />
        </span>
        <span className="font-display text-xl font-bold tracking-tight">Dentbook</span>
      </Link>

      <nav className="flex items-center gap-0.5">
        <Link href="/clinics" className={navLinkClass}>{t("clinics")}</Link>
        <Link href="/products" className={navLinkClass}>{t("products")}</Link>
        <Link href="/about" className={navLinkClass}>{t("about")}</Link>
        <Link href="/contact" className={navLinkClass}>{t("contact")}</Link>
        {(!session || session.user.kind === "patient") && (
          <Link href="/register" className={navLinkClass}>{t("listClinic")}</Link>
        )}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {session ? (
          <>
            {session.user.kind === "patient" && (
              <Link
                href="/favorites"
                className="flex items-center gap-1.5 border border-ink-line px-3 py-2 text-sm text-cream transition-colors hover:border-ink-line-hover"
              >
                <span className="text-coral" aria-hidden="true">♥</span> {favCount}
              </Link>
            )}
            <Link
              href="/profile"
              className="flex items-center gap-2 border border-ink-line px-3 py-1.5 text-sm font-medium text-cream transition-colors hover:border-ink-line-hover"
            >
              <span className="grid h-6.5 w-6.5 place-items-center bg-accent text-xs font-bold text-ink">
                {initialsOf(session.user.name)}
              </span>
              {t("profile")}
            </Link>
            {session.user.isPlatformAdmin && (
              <Link href="/admin" className={navLinkClass}>{t("admin")}</Link>
            )}
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button type="submit" className={navLinkClass}>{t("signOut")}</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className={navLinkClass}>{t("login")}</Link>
            <Link
              href="/register"
              className="bg-accent px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-accent-hover"
            >
              {t("register")}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
