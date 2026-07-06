import { withDbContext } from "./tenant-db";
import { computeSlots, wallTimeToUtc, type Slot } from "./slots";

export class AvailabilityError extends Error {
  constructor(public code: "NOT_FOUND" | "INVALID_INPUT") { super(code); }
}

export interface AvailableSlot extends Slot { membershipId: string }

export interface AvailabilityQuery {
  clinicSlug: string;
  serviceId: string;
  membershipId?: string | null; // omitted/null = any dentist
  dateISO: string;              // YYYY-MM-DD, clinic-local calendar day
  now?: Date;                   // injectable for tests
}

export async function getAvailableSlots(q: AvailabilityQuery): Promise<AvailableSlot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.dateISO)) throw new AvailabilityError("INVALID_INPUT");
  const now = q.now ?? new Date();
  return withDbContext({ role: "auth" }, async (tx) => {
    const clinic = await tx.clinic.findUnique({ where: { slug: q.clinicSlug } });
    if (!clinic?.published) throw new AvailabilityError("NOT_FOUND");
    const service = await tx.service.findUnique({ where: { id: q.serviceId } });
    if (!service || service.clinicId !== clinic.id || !service.active) {
      throw new AvailabilityError("NOT_FOUND");
    }
    const links = await tx.dentistService.findMany({
      where: { serviceId: service.id } });
    const dentists = await tx.membership.findMany({
      where: { clinicId: clinic.id, role: "DENTIST" },
      include: { schedules: true },
    });
    // dentist_services links restrict which dentists offer the service;
    // a service with no links is offered by every dentist of the clinic.
    const allowed = dentists.filter((m) =>
      (links.length === 0 || links.some((l) => l.membershipId === m.id)) &&
      (!q.membershipId || m.id === q.membershipId));
    if (allowed.length === 0) return [];

    const dayStart = wallTimeToUtc(q.dateISO, 0, clinic.timezone);
    const dayEnd = wallTimeToUtc(q.dateISO, 1440, clinic.timezone);
    const [exceptions, busy] = await Promise.all([
      tx.scheduleException.findMany({
        where: { clinicId: clinic.id, date: new Date(`${q.dateISO}T00:00:00Z`) } }),
      tx.appointment.findMany({
        where: { membershipId: { in: allowed.map((m) => m.id) },
                 status: { in: ["PENDING", "CONFIRMED"] },
                 startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } } }),
    ]);

    const out: AvailableSlot[] = [];
    for (const m of allowed) {
      // dentist-specific exception wins over clinic-wide
      const exc = exceptions.find((e) => e.membershipId === m.id)
        ?? exceptions.find((e) => e.membershipId === null);
      const slots = computeSlots({
        dateISO: q.dateISO,
        timezone: clinic.timezone,
        weekly: m.schedules,
        exceptions: exc
          ? [{ date: q.dateISO, closed: exc.closed,
               startMin: exc.startMin, endMin: exc.endMin }]
          : [],
        busy: busy.filter((b) => b.membershipId === m.id),
        durationMin: service.durationMin,
        stepMin: 15,
        notBefore: now,
      });
      out.push(...slots.map((s) => ({ ...s, membershipId: m.id })));
    }
    return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  });
}
