import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const baseClasses = "px-4 py-2.5 text-sm font-semibold transition-colors";
const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-ink hover:bg-accent-hover",
  secondary: "border border-ink-line text-cream hover:border-ink-line-hover",
};

function classesFor(variant: Variant, className?: string) {
  return [baseClasses, variantClasses[variant], className].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={classesFor(variant, className)} {...props} />;
}

export interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  className?: string;
  children?: React.ReactNode;
}

export function ButtonLink({ href, variant = "primary", className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={classesFor(variant, className)}>
      {children}
    </Link>
  );
}
