import { getTranslations, getFormatter } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";
import { cancelAppointmentByStaff, completeAppointment, markNoShow } from "@/lib/appointment-actions";

export default async function AppointmentsToday() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard");
  const tStatus = await getTranslations("Manage.status");
  const format = await getFormatter();
  const now = new Date();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const pastStart = new Date(start); pastStart.setDate(pastStart.getDate() - 30);

  const include = {
    patient: true, service: true,
    membership: { include: { user: true } },
    payment: true,
  } as const;

  const [todayAppts, pastAppts] = await Promise.all([
    withDbContext(
      { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
      (tx) => tx.appointment.findMany({
        where: { startsAt: { gte: start, lt: end } },
        include, orderBy: { startsAt: "asc" },
      })),
    withDbContext(
      { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
      (tx) => tx.appointment.findMany({
        where: { status: "CONFIRMED", startsAt: { gte: pastStart, lt: start } },
        include, orderBy: { startsAt: "asc" },
      })),
  ]);

  async function completeAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await completeAppointment(c, String(formData.get("id")));
    revalidatePath("/dashboard");
  }
  async function noShowAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await markNoShow(c, String(formData.get("id")));
    revalidatePath("/dashboard");
  }
  async function cancelAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await cancelAppointmentByStaff(c, String(formData.get("id")));
    revalidatePath("/dashboard");
  }

  const renderRow = (a: (typeof todayAppts)[number], compact: boolean) => {
    const started = a.startsAt <= now;
    const canCancel = (a.status === "PENDING" || a.status === "CONFIRMED") && !started;
    const canCloseOut = a.status === "CONFIRMED" && started;
    return (
      <div key={a.id}
           className="flex flex-wrap items-center justify-between gap-3 border border-ink-line bg-ink-surface p-4">
        <span>
          <span className="font-semibold text-cream">
            {compact
              ? format.dateTime(a.startsAt, { hour: "2-digit", minute: "2-digit" })
              : format.dateTime(a.startsAt, { dateStyle: "medium", timeStyle: "short" })}
          </span>
          <span className="text-muted"> — {a.patient.name} · {a.service.nameSq} · {a.membership.user.name}</span>
          <span className="ml-2 border border-ink-line px-2 py-0.5 text-xs font-semibold tracking-[0.04em] text-muted-2">
            {tStatus(a.status as never)}
          </span>
          {a.payment && (a.payment.status === "SUCCEEDED" || a.payment.status === "PENDING") && (
            <span className="ml-2 border border-ink-line px-2 py-0.5 text-xs font-semibold tracking-[0.04em] text-muted-2">
              {a.payment.status === "SUCCEEDED" ? t("depositPaid") : t("depositPending")}
              {" · "}
              {format.number(Number(a.payment.amountEur), { style: "currency", currency: "EUR" })}
            </span>
          )}
        </span>
        {(canCloseOut || canCancel) && (
          <span className="flex gap-2">
            {canCloseOut && (
              <>
                <form action={completeAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="bg-accent px-3 py-1.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">
                    {t("complete")}
                  </button>
                </form>
                <form action={noShowAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="border border-ink-line px-3 py-1.5 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                    {t("noShow")}
                  </button>
                </form>
              </>
            )}
            {canCancel && (
              <form action={cancelAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="border border-coral px-3 py-1.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10">
                  {t("cancel")}
                </button>
              </form>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("todayTitle")}</h1>
      {todayAppts.length === 0 && <p className="mt-4 text-muted">{t("noAppointments")}</p>}
      <div className="mt-6 grid gap-2.5">
        {todayAppts.map((a) => renderRow(a, true))}
      </div>

      {pastAppts.length > 0 && (
        <>
          <h2 className="mt-10 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
            {t("awaitingOutcome").toUpperCase()}
          </h2>
          <div className="mt-3.5 grid gap-2.5">
            {pastAppts.map((a) => renderRow(a, false))}
          </div>
        </>
      )}
    </div>
  );
}
