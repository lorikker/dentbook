import Link from "next/link";
import { ToothIcon } from "@/components/ToothIcon";

const navLinkClass =
  "px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-cream";

// Lightweight top nav for the (English-only, non-localized) Pages Router
// routes under `pages/`. The App Router's `Header` is an async Server
// Component and can't be rendered here, so this stands in for it.
export function PagesNav() {
  return (
    <header className="flex h-16 items-center gap-8 border-b border-ink-line bg-ink px-8">
      <Link href="/" className="flex items-center gap-2.5 text-cream">
        <span className="grid h-7.5 w-7.5 place-items-center bg-cream text-ink">
          <ToothIcon className="h-4.5 w-4.5" />
        </span>
        <span className="font-display text-xl font-bold tracking-tight">Dentbook</span>
      </Link>
      <nav className="flex items-center gap-0.5">
        <Link href="/clinics" className={navLinkClass}>Clinics</Link>
        <Link href="/products" className={navLinkClass}>Products</Link>
        <Link href="/favorites" className={navLinkClass}>Favorites</Link>
      </nav>
    </header>
  );
}
