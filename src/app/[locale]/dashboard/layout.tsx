import Link from "next/link";
import { getTranslations, getFormatter } from "next-intl/server";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";
import { getClinicBillingStatus } from "@/lib/billing";

export default async function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard");
  const format = await getFormatter();
  const [clinic, billing] = await Promise.all([
    withDbContext(
      { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
      (tx) => tx.clinic.findUniqueOrThrow({ where: { id: ctx.clinicId } }),
    ),
    getClinicBillingStatus(ctx),
  ]);
  const nav = [
    ["", t("nav.appointments")], ["requests", t("nav.requests")],
    ["services", t("nav.services")], ["staff", t("nav.staff")],
    ["schedules", t("nav.schedules")], ["settings", t("nav.settings")],
  ] as const;
  return (
    <div className="flex min-h-[calc(100vh-4rem)] bg-ink text-cream">
      <aside className="w-60 shrink-0 border-r border-ink-line bg-ink-surface p-5">
        <p className="mb-6 text-[11.5px] font-bold tracking-[0.11em] text-muted-2">
          {clinic.name.toUpperCase()}
        </p>
        <nav className="flex flex-col gap-1">
          {nav.map(([href, label]) => (
            <Link key={href} href={`/dashboard/${href}`}
                  className="px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-ink hover:text-cream">
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">
        {billing?.status === "PAST_DUE" && (
          <p className="mb-6 border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">
            {t("billing.pastDue")}
          </p>
        )}
        {billing?.plan === "TRIAL" && billing.trialEndsAt && (
          <p className="mb-6 text-sm text-muted">
            {t("billing.trialEnds", { date: format.dateTime(billing.trialEndsAt, { dateStyle: "medium" }) })}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
