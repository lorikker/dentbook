import { getTranslations, getFormatter } from "next-intl/server";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";

export default async function AppointmentsToday() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard");
  const format = await getFormatter();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const appts = await withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.appointment.findMany({
      where: { startsAt: { gte: start, lt: end } },
      include: { patient: true, service: true, membership: { include: { user: true } } },
      orderBy: { startsAt: "asc" },
    }),
  );
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("todayTitle")}</h1>
      {appts.length === 0 && <p className="text-gray-500">{t("noAppointments")}</p>}
      <ul className="flex flex-col gap-2">
        {appts.map((a) => (
          <li key={a.id} className="rounded border p-3">
            <span className="font-mono">{format.dateTime(a.startsAt, { hour: "2-digit", minute: "2-digit" })}</span>
            {" — "}{a.patient.name} · {a.service.nameSq} · {a.membership.user.name}
            <span className="ml-2 rounded bg-gray-100 px-2 text-sm">{a.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
