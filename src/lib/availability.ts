import type { Prisma } from "@/generated/prisma/client";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Clinic, service and the dentists allowed to take `serviceId`, shared by
 * the single-day and range queries below. */
async function resolveAllowedDentists(
  tx: Prisma.TransactionClient,
  clinicSlug: string, serviceId: string, membershipId?: string | null,
) {
  const clinic = await tx.clinic.findUnique({ where: { slug: clinicSlug } });
  if (!clinic?.published) throw new AvailabilityError("NOT_FOUND");
  const service = await tx.service.findUnique({ where: { id: serviceId } });
  if (!service || service.clinicId !== clinic.id || !service.active) {
    throw new AvailabilityError("NOT_FOUND");
  }
  const links = await tx.dentistService.findMany({ where: { serviceId: service.id } });
  const dentists = await tx.membership.findMany({
    where: { clinicId: clinic.id, role: "DENTIST" },
    include: { schedules: true },
  });
  // dentist_services links restrict which dentists offer the service;
  // a service with no links is offered by every dentist of the clinic.
  const allowed = dentists.filter((m) =>
    (links.length === 0 || links.some((l) => l.membershipId === m.id)) &&
    (!membershipId || m.id === membershipId));
  return { clinic, service, allowed };
}

export async function getAvailableSlots(q: AvailabilityQuery): Promise<AvailableSlot[]> {
  if (!DATE_RE.test(q.dateISO)) throw new AvailabilityError("INVALID_INPUT");
  const now = q.now ?? new Date();
  return withDbContext({ role: "auth" }, async (tx) => {
    const { clinic, service, allowed } =
      await resolveAllowedDentists(tx, q.clinicSlug, q.serviceId, q.membershipId);
    if (allowed.length === 0) return [];

    const dayStart = wallTimeToUtc(q.dateISO, 0, clinic.timezone);
    const dayEnd = wallTimeToUtc(q.dateISO, 1440, clinic.timezone);
    // Sequential on purpose. Every query in this block runs on the single
    // pooled connection held by the enclosing interactive transaction, so
    // Promise.all buys no concurrency here — node-postgres just queues the
    // second query behind the first — while emitting a deprecation warning
    // that becomes a hard removal in pg@9. See withDbContext's doc comment.
    const exceptions = await tx.scheduleException.findMany({
      where: { clinicId: clinic.id, date: new Date(`${q.dateISO}T00:00:00Z`) } });
    const busy = await tx.appointment.findMany({
      where: { membershipId: { in: allowed.map((m) => m.id) },
               status: { in: ["PENDING", "CONFIRMED", "AWAITING_PAYMENT"] },
               startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } } });

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

export interface AvailabilityRangeQuery {
  clinicSlug: string;
  serviceId: string;
  membershipId?: string | null; // omitted/null = any dentist
  fromDateISO: string;          // YYYY-MM-DD, clinic-local calendar day, inclusive
  toDateISO: string;            // YYYY-MM-DD, clinic-local calendar day, inclusive
  now?: Date;                   // injectable for tests
}

/** `@db.Date` columns come back as UTC midnight; the calendar day is just the date part. */
function dateOnlyISO(d: Date): string { return d.toISOString().slice(0, 10); }

function eachDateISO(fromISO: string, toISO: string): string[] {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  const days: string[] = [];
  for (let t = from; t <= to; t += 86_400_000) days.push(dateOnlyISO(new Date(t)));
  return days;
}

/**
 * Same shape as getAvailableSlots but across a window of clinic-local days.
 * Fetches exceptions/busy appointments for the whole window in one pair of
 * queries (not one pair per day) and computes each day in memory.
 */
export async function getAvailableSlotsRange(
  q: AvailabilityRangeQuery,
): Promise<AvailableSlot[]> {
  if (!DATE_RE.test(q.fromDateISO) || !DATE_RE.test(q.toDateISO)) {
    throw new AvailabilityError("INVALID_INPUT");
  }
  const now = q.now ?? new Date();
  return withDbContext({ role: "auth" }, async (tx) => {
    const { clinic, service, allowed } =
      await resolveAllowedDentists(tx, q.clinicSlug, q.serviceId, q.membershipId);
    if (allowed.length === 0) return [];

    const rangeStart = wallTimeToUtc(q.fromDateISO, 0, clinic.timezone);
    const rangeEnd = wallTimeToUtc(q.toDateISO, 1440, clinic.timezone);
    // Sequential on purpose — see the doc comment on withDbContext.
    const exceptions = await tx.scheduleException.findMany({
      where: { clinicId: clinic.id,
               date: { gte: new Date(`${q.fromDateISO}T00:00:00Z`),
                       lte: new Date(`${q.toDateISO}T00:00:00Z`) } } });
    const busy = await tx.appointment.findMany({
      where: { membershipId: { in: allowed.map((m) => m.id) },
               status: { in: ["PENDING", "CONFIRMED", "AWAITING_PAYMENT"] },
               startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } } });

    const out: AvailableSlot[] = [];
    for (const dateISO of eachDateISO(q.fromDateISO, q.toDateISO)) {
      for (const m of allowed) {
        // dentist-specific exception wins over clinic-wide
        const exc = exceptions.find((e) => e.membershipId === m.id && dateOnlyISO(e.date) === dateISO)
          ?? exceptions.find((e) => e.membershipId === null && dateOnlyISO(e.date) === dateISO);
        const slots = computeSlots({
          dateISO,
          timezone: clinic.timezone,
          weekly: m.schedules,
          exceptions: exc
            ? [{ date: dateISO, closed: exc.closed,
                 startMin: exc.startMin, endMin: exc.endMin }]
            : [],
          busy: busy.filter((b) => b.membershipId === m.id),
          durationMin: service.durationMin,
          stepMin: 15,
          notBefore: now,
        });
        out.push(...slots.map((s) => ({ ...s, membershipId: m.id })));
      }
    }
    return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  });
}
