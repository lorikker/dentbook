export interface ToothIconProps {
  className?: string;
  flip?: boolean;
}

/** Shared tooth glyph used for the brand mark and the FDI tooth chart. */
export function ToothIcon({ className, flip }: ToothIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      style={flip ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M12 2.4c3.5 0 5.9 2.1 5.9 5.4 0 2-.7 3.5-1.2 5.4-.5 2-.6 4.8-1.3 7-.4 1.3-1.9 1.4-2.3 0-.5-1.6-.6-4.1-1.1-4.1s-.6 2.5-1.1 4.1c-.4 1.4-1.9 1.3-2.3 0-.7-2.2-.8-5-1.3-7-.5-1.9-1.2-3.4-1.2-5.4 0-3.3 2.4-5.4 5.9-5.4z" />
    </svg>
  );
}
