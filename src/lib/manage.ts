import { withDbContext } from "./tenant-db";
import { getAvailableSlots } from "./availability";
import { isExclusionViolation, clinicLocalDateISO } from "./booking";
import { notifyAppointment } from "./notify";

export class ManageError extends Error {
  constructor(public code: "NOT_FOUND" | "NOT_ACTIVE" | "WINDOW_PASSED" | "SLOT_TAKEN") {
    super(code);
  }
}

const ACTIVE: readonly string[] = ["PENDING", "CONFIRMED"];

export async function getAppointmentByToken(token: string, now = new Date()) {
  const appt = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findUnique({
      where: { manageToken: token },
      include: { clinic: true, service: true,
                 membership: { include: { user: true } } },
    }));
  if (!appt) return null;
  if (appt.endsAt < now) return null; // manage links expire after the appointment ends
  const windowMs = appt.clinic.cancellationWindowHours * 3600 * 1000;
  const withinWindow = now.getTime() <= appt.startsAt.getTime() - windowMs;
  const cancellable = ACTIVE.includes(appt.status) && withinWindow;
  return { appointment: appt, cancellable };
}

async function requireCancellable(token: string, now: Date) {
  const found = await getAppointmentByToken(token, now);
  if (!found) throw new ManageError("NOT_FOUND");
  if (!ACTIVE.includes(found.appointment.status)) throw new ManageError("NOT_ACTIVE");
  if (!found.cancellable) throw new ManageError("WINDOW_PASSED");
  return found.appointment;
}

export async function cancelViaToken(token: string, now = new Date()) {
  const appt = await requireCancellable(token, now);
  const updated = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.update({
      where: { id: appt.id }, data: { status: "CANCELLED" } }));
  await notifyAppointment("booking_cancelled", updated.id);
  return updated;
}

export async function rescheduleViaToken(
  token: string, newStartsAtISO: string, now = new Date(),
) {
  const appt = await requireCancellable(token, now);
  const newStart = new Date(newStartsAtISO);
  if (Number.isNaN(newStart.getTime())) throw new ManageError("SLOT_TAKEN");
  const dateISO = clinicLocalDateISO(newStart, appt.clinic.timezone);
  const slots = await getAvailableSlots({
    clinicSlug: appt.clinic.slug, serviceId: appt.serviceId,
    membershipId: appt.membershipId, dateISO, now });
  const slot = slots.find((s) => s.startsAt.getTime() === newStart.getTime());
  if (!slot) throw new ManageError("SLOT_TAKEN");
  try {
    const updated = await withDbContext({ role: "auth" }, (tx) =>
      tx.appointment.update({
        where: { id: appt.id },
        data: { startsAt: slot.startsAt, endsAt: slot.endsAt } }));
    await notifyAppointment("booking_rescheduled", updated.id);
    return updated;
  } catch (e) {
    if (isExclusionViolation(e)) throw new ManageError("SLOT_TAKEN");
    throw e;
  }
}
