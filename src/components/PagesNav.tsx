import { ButtonLink } from "@/components/Button";

// Lightweight top nav for the (English-only, non-localized) Pages Router
// routes under `pages/`. The App Router's `Header` is an async Server
// Component and can't be rendered here, so this stands in for it.
export function PagesNav() {
  return (
    <nav className="flex items-center gap-3 border-b p-4">
      <ButtonLink href="/" variant="secondary">
        Home
      </ButtonLink>
      <ButtonLink href="/clinics" variant="secondary">
        Clinics
      </ButtonLink>
      <ButtonLink href="/products" variant="secondary">
        Products
      </ButtonLink>
      <ButtonLink href="/favorites" variant="secondary">
        Favorites
      </ButtonLink>
    </nav>
  );
}
