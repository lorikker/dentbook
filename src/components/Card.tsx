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
      <p className="font-semibold">{title}</p>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded border p-4 hover:bg-gray-50">
        {body}
      </Link>
    );
  }

  return <div className="rounded border p-4">{body}</div>;
}
