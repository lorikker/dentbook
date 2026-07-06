import { getTranslations, getFormatter } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";
import { acceptAppointment, declineAppointment,
         expireStalePending } from "@/lib/appointment-actions";

export default async function RequestsPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.requests");
  const format = await getFormatter();
  await expireStalePending(ctx); // lazy expiry until the Phase 4 worker exists
  const pending = await withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.appointment.findMany({
      where: { status: "PENDING" },
      include: { patient: true, service: true,
                 membership: { include: { user: true } } },
      orderBy: { startsAt: "asc" },
    }));

  async function acceptAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await acceptAppointment(c, String(formData.get("id")));
    revalidatePath("/dashboard/requests");
  }
  async function declineAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await declineAppointment(c, String(formData.get("id")));
    revalidatePath("/dashboard/requests");
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      {pending.length === 0 && <p className="text-gray-500">{t("empty")}</p>}
      <ul className="flex flex-col gap-2">
        {pending.map((a) => (
          <li key={a.id}
              className="flex items-center justify-between rounded border p-3">
            <span>
              <span className="font-mono">
                {format.dateTime(a.startsAt, {
                  dateStyle: "medium", timeStyle: "short" })}
              </span>
              {" — "}{a.patient.name} · {a.service.nameSq} · {a.membership.user?.name}
            </span>
            <span className="flex gap-2">
              <form action={acceptAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="rounded bg-green-600 px-3 py-1 text-sm text-white">
                  {t("accept")}
                </button>
              </form>
              <form action={declineAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
                  {t("decline")}
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
