export interface ContainerProps {
  children?: React.ReactNode;
  className?: string;
  /** default: 1240px (directory/dashboard-style pages). narrow: 1000px (forms/detail). */
  size?: "default" | "narrow";
}

export function Container({ children, className, size = "default" }: ContainerProps) {
  const width = size === "narrow" ? "max-w-3xl" : "max-w-6xl";
  return (
    <div className={[width, "mx-auto w-full px-8", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
