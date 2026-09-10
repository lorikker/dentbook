import Link from "next/link";

export interface CardProps {
  href?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function Card({ href, title, subtitle, children }: CardProps) {
  const body = (
    <>
      <p className="font-semibold text-cream">{title}</p>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      {children}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block border border-ink-line bg-ink-surface p-4 transition-colors hover:border-ink-line-hover"
      >
        {body}
      </Link>
    );
  }

  return <div className="border border-ink-line bg-ink-surface p-4">{body}</div>;
}
