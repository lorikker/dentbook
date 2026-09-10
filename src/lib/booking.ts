import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { getAvailableSlots } from "./availability";
import { expireUnpaidDeposits } from "./deposits";
import { logActivity } from "./models/activity-log";

export class BookingError extends Error {
  constructor(public code: "INVALID_INPUT" | "NOT_FOUND" | "SLOT_TAKEN") { super(code); }
}

const schema = z.object({
  clinicSlug: z.string().min(1),
  serviceId: z.string().uuid(),
  membershipId: z.string().uuid(),
  patientUserId: z.string().uuid(),
  startsAtISO: z.string(),
});
export type BookingInput = z.infer<typeof schema>;

/** The clinic-local calendar day an instant falls on (en-CA = YYYY-MM-DD). */
export function clinicLocalDateISO(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

/** Postgres exclusion constraint no_double_booking → SLOT_TAKEN. */
export function isExclusionViolation(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const msg = (cur as { message?: unknown }).message;
    if (typeof msg === "string" && msg.includes("no_double_booking")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export async function createBooking(input: BookingInput) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BookingError("INVALID_INPUT");
  const d = parsed.data;
  const startsAt = new Date(d.startsAtISO);
  if (Number.isNaN(startsAt.getTime())) throw new BookingError("INVALID_INPUT");

  const { clinic, service } = await withDbContext({ role: "auth" }, async (tx) => ({
    clinic: await tx.clinic.findUnique({ where: { slug: d.clinicSlug } }),
    service: await tx.service.findUnique({ where: { id: d.serviceId } }),
  }));
  if (!clinic?.published) throw new BookingError("NOT_FOUND");

  // Abandoned deposit checkouts keep holding their slots until swept; sweep
  // first so a lapsed hold never blocks a real booking.
  await expireUnpaidDeposits();

  const dateISO = clinicLocalDateISO(startsAt, clinic.timezone);
  const slots = await getAvailableSlots({
    clinicSlug: d.clinicSlug, serviceId: d.serviceId,
    membershipId: d.membershipId, dateISO });
  const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw new BookingError("SLOT_TAKEN");

  // A deposit service holds the slot until paid; deposits.ts then confirms
  // it or turns it into a request, per the clinic's booking mode.
  const status = Number(service?.depositEur ?? 0) > 0 ? "AWAITING_PAYMENT"
    : clinic.bookingMode === "INSTANT" ? "CONFIRMED" : "PENDING";

  try {
    const appt = await withDbContext(
      { role: "auth", userId: d.patientUserId },
      (tx) => tx.appointment.create({
        data: {
          clinicId: clinic.id, membershipId: d.membershipId,
          patientUserId: d.patientUserId, serviceId: d.serviceId,
          startsAt: slot.startsAt, endsAt: slot.endsAt, status,
        },
      }));
    // Non-fatal: the appointment is already committed, so a Mongo hiccup
    // here must not surface as a booking failure to the patient.
    try {
      await logActivity("appointment_booked", "New appointment booked", { appointmentId: appt.id });
    } catch (e) {
      console.error("logActivity(appointment_booked) failed", e);
    }
    return { appointmentId: appt.id, manageToken: appt.manageToken,
             status: appt.status as "PENDING" | "CONFIRMED" | "AWAITING_PAYMENT" };
  } catch (e) {
    if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN");
    throw e;
  }
}
