import Link from "next/link";

export interface FilterChipProps {
  href: string;
  active: boolean;
  children?: React.ReactNode;
}

export function FilterChip({ href, active, children }: FilterChipProps) {
  return (
    <Link
      href={href}
      className={[
        "border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-cream bg-cream text-ink"
          : "border-ink-line bg-ink text-muted-2 hover:border-ink-line-hover",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}
