import Link from "next/link";
import { ToothIcon } from "@/components/ToothIcon";

export interface AuthShellProps {
  active: "login" | "register";
  loginTab: string;
  registerTab: string;
  panelTitle: string;
  panelBody: string;
  children?: React.ReactNode;
}

function tabClass(active: boolean) {
  return [
    "border px-3.5 py-2 text-sm font-semibold transition-colors",
    active ? "border-cream bg-cream text-ink" : "border-ink-line text-muted-2 hover:border-ink-line-hover",
  ].join(" ");
}

export function AuthShell({ active, loginTab, registerTab, panelTitle, panelBody, children }: AuthShellProps) {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] bg-ink text-cream lg:grid-cols-2">
      <div className="border-b border-ink-line px-6 py-14 sm:px-12 lg:border-b-0 lg:border-r">
        <div className="flex gap-2">
          <Link href="/login" className={tabClass(active === "login")}>{loginTab}</Link>
          <Link href="/register" className={tabClass(active === "register")}>{registerTab}</Link>
        </div>
        <div className="mt-8 max-w-sm">{children}</div>
      </div>

      <div className="relative hidden overflow-hidden bg-ink lg:grid lg:place-items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-ink-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-ink-line) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
          }}
        />
        <div
          aria-hidden="true"
          className="animate-db-scan absolute left-0 right-0 h-px bg-accent shadow-[0_0_14px_1px_rgba(157,184,245,0.5)]"
        />
        <div className="relative max-w-sm px-10 text-center">
          <ToothIcon className="mx-auto h-20 w-20 text-ink-line" />
          <p className="mt-5 font-display text-2xl font-bold tracking-tight">{panelTitle}</p>
          <p className="mt-3 text-muted">{panelBody}</p>
        </div>
      </div>
    </div>
  );
}
