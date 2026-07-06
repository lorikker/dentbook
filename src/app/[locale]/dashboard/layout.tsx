import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";

export default async function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard");
  const clinic = await withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.clinic.findUniqueOrThrow({ where: { id: ctx.clinicId } }),
  );
  const nav = [
    ["", t("nav.appointments")], ["services", t("nav.services")],
    ["staff", t("nav.staff")], ["schedules", t("nav.schedules")],
    ["settings", t("nav.settings")],
  ] as const;
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-gray-50 p-4">
        <p className="mb-6 font-bold">{clinic.name}</p>
        <nav className="flex flex-col gap-2">
          {nav.map(([href, label]) => (
            <Link key={href} href={`/dashboard/${href}`}
                  className="rounded px-2 py-1 hover:bg-gray-200">{label}</Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
