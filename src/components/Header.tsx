import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";

export async function Header() {
  const session = await auth();
  const t = await getTranslations("Header");

  return (
    <header className="flex items-center justify-between border-b p-4">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-lg font-bold text-sky-600">
          Dentbook
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/clinics">{t("clinics")}</Link>
          <Link href="/products">{t("products")}</Link>
          <Link href="/about">{t("about")}</Link>
          <Link href="/contact">{t("contact")}</Link>
        </nav>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {session ? (
          <>
            <Link href="/profile">{t("profile")}</Link>
            {session.user.isPlatformAdmin && <Link href="/admin">{t("admin")}</Link>}
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button type="submit">{t("signOut")}</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login">{t("login")}</Link>
            <Link href="/register">{t("register")}</Link>
          </>
        )}
      </div>
    </header>
  );
}
