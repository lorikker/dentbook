import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";

const footerLinkClass = "text-sm text-muted-2 transition-colors hover:text-cream";

export async function Footer() {
  const session = await auth();
  const t = await getTranslations("Header");
  const tCommon = await getTranslations("Common");

  return (
    <footer className="border-t border-ink-line bg-ink px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-2">
          © {new Date().getFullYear()} {tCommon("appName")}
        </p>
        <div className="flex items-center gap-6">
          <Link href="/contact" className={footerLinkClass}>{t("contact")}</Link>
          <Link href="/products" className={footerLinkClass}>{t("products")}</Link>
          {session?.user?.isPlatformAdmin && (
            <Link href="/admin" className={footerLinkClass}>{t("admin")}</Link>
          )}
        </div>
      </div>
    </footer>
  );
}
