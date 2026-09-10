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
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      {pending.length === 0 && <p className="mt-4 text-muted">{t("empty")}</p>}
      <div className="mt-6 grid gap-2.5">
        {pending.map((a) => (
          <div key={a.id}
               className="flex flex-wrap items-center justify-between gap-3 border border-ink-line bg-ink-surface p-4">
            <span>
              <span className="font-semibold text-cream">
                {format.dateTime(a.startsAt, {
                  dateStyle: "medium", timeStyle: "short" })}
              </span>
              <span className="text-muted"> — {a.patient.name} · {a.service.nameSq} · {a.membership.user?.name}</span>
            </span>
            <span className="flex gap-2">
              <form action={acceptAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="bg-accent px-3.5 py-1.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">
                  {t("accept")}
                </button>
              </form>
              <form action={declineAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="border border-coral px-3.5 py-1.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10">
                  {t("decline")}
                </button>
              </form>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
