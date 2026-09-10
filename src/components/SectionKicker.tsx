export interface SectionKickerProps {
  children?: React.ReactNode;
  /** Pulsing accent dot in front of the label — used once, in the hero. */
  dot?: boolean;
  className?: string;
}

export function SectionKicker({ children, dot, className }: SectionKickerProps) {
  return (
    <div
      className={[
        "flex items-center gap-2.5 text-xs font-semibold tracking-[0.14em] text-muted",
        className,
      ].filter(Boolean).join(" ")}
    >
      {dot && (
        <span className="h-2 w-2 shrink-0 animate-db-blink bg-accent" aria-hidden="true" />
      )}
      {children}
    </div>
  );
}
