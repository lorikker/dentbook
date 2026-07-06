# Dentbook Phase 3 — Patient Booking Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A patient can find a published clinic on the marketplace, book a verified appointment (phone OTP) into a server-computed free slot, receive SMS through the notifications outbox, and cancel/reschedule via a login-free manage link; approval-mode clinics work the request queue from the dashboard.

**Architecture:** All booking logic lives in small DB-backed lib functions running under `withDbContext` (`auth` role = trusted server flows, `public` role = marketplace reads, `staff` role = dashboard actions). Availability is DB glue over the pure `computeSlots` from Phase 2. Double-booking safety rests on the Postgres exclusion constraint — availability checks are advisory, the constraint is the backstop. SMS goes through the `notifications` outbox table then a provider. UI is server-rendered multi-step forms (no client JS), same style as Phase 2.

**Tech Stack:** as Phase 2 (Next 16, Prisma 7 + adapter-pg, Auth.js v5, next-intl, Vitest, Zod). No new dependencies — Twilio is called with plain `fetch`.

**Spec:** `docs/superpowers/specs/2026-07-05-dentbook-design.md` (§8 booking/cancel flows, §6 status machine, §9 security, §10 test priorities 3–4)
**Branch:** `feature/phase-3-booking`

## Global Constraints

- Next.js 16 has breaking changes — consult `node_modules/next/dist/docs/` when unsure; `params`/`searchParams` are Promises; server actions are inline `"use server"` functions.
- Never call `redirect()` inside a `try` whose `catch` redirects — `redirect` throws `NEXT_REDIRECT` and your own catch will swallow it. Capture the destination, redirect after the try/catch.
- Every user-facing string goes in **both** `src/messages/sq.json` and `src/messages/en.json` (sq is the default locale).
- ALL request-path DB access goes through `withDbContext` (`src/lib/tenant-db.ts`). Never import `prismaDirect` in request code.
- Currency EUR; clinic timezone stored per clinic (`Europe/Belgrade` default); appointments stored as UTC instants.
- Commits: plain messages, no Co-Authored-By trailers (hard user rule).
- Test commands: `npm run test -- tests/<file>.test.ts` (Postgres must be running: `npm run db:start` if needed).
- Migrations: `npx prisma migrate dev --create-only --name <name>`, edit the SQL, then `npx prisma migrate dev`.

## Out of scope for Phase 3 (later phases)

Deposits / MockPaymentProvider checkout; pg-boss worker, 24h reminder jobs, review invitations; reviews UI; platform admin; branded `{slug}.<domain>` subdomains; staff-side reschedule UI (staff cancel is in; staff rebooking on behalf of a patient is Phase 4); Playwright E2E; Docker deployment.

---

## File structure created by this plan

```
src/
├── lib/
│   ├── availability.ts          # free slots for clinic/service/dentist/date (DB glue over slots.ts)
│   ├── booking.ts               # createBooking + exclusion-constraint mapping
│   ├── notify.ts                # notifications outbox writer + SMS dispatch
│   ├── manage.ts                # manage-token read/cancel/reschedule (login-free)
│   ├── appointment-actions.ts   # staff status transitions + pending expiry
│   └── sms/twilio.ts            # TwilioSmsProvider (fetch-based)
├── app/[locale]/
│   ├── clinics/page.tsx             # marketplace list + city filter
│   ├── clinics/[slug]/page.tsx      # clinic profile (services, dentists)
│   ├── clinics/[slug]/book/page.tsx # booking wizard (service→dentist→date→slot→OTP)
│   ├── manage/[token]/page.tsx      # manage page (details, cancel, reschedule link)
│   └── dashboard/requests/page.tsx  # approval queue (accept/decline)
prisma/migrations/<ts>_booking_rls/migration.sql
tests/
├── availability.test.ts
├── booking.test.ts
├── notify.test.ts
├── manage.test.ts
├── appointment-actions.test.ts
└── sms-twilio.test.ts
```

Modified: `src/app/[locale]/dashboard/layout.tsx` (nav item), `src/app/[locale]/dashboard/page.tsx` (staff cancel), `src/app/[locale]/page.tsx` (CTA → /clinics), `src/lib/sms/index.ts` (twilio case), `.env` (APP_URL), both message files.

---

### Task 1: Booking RLS migration + availability lib

**Files:**
- Create: `prisma/migrations/<ts>_booking_rls/migration.sql`, `src/lib/availability.ts`
- Test: `tests/availability.test.ts`

**Interfaces:**
- Consumes: `computeSlots`, `wallTimeToUtc` from `src/lib/slots.ts`; `withDbContext` from `src/lib/tenant-db.ts`.
- Produces: `getAvailableSlots(q: AvailabilityQuery): Promise<AvailableSlot[]>` where `AvailabilityQuery = { clinicSlug: string; serviceId: string; membershipId?: string | null; dateISO: string; now?: Date }` and `AvailableSlot = { startsAt: Date; endsAt: Date; membershipId: string }`. Throws `AvailabilityError` with `code: "NOT_FOUND" | "INVALID_INPUT"`. Tasks 2 and 4 call this.

Why the migration: the `auth` role (trusted server flows) needs to read/insert/update appointments — anonymous manage-token and pre-OTP availability flows have no clinic/user context. And the marketplace (`public` role) must see dentist **user** names at published clinics (spec §5 "public policies… dentist profiles"), which `users_select` currently blocks.

- [ ] **Step 1: create the migration**

```powershell
npx prisma migrate dev --create-only --name booking_rls
```

Replace the generated empty `migration.sql` with:

```sql
-- Booking, availability, and manage-token flows run in the trusted 'auth'
-- context (no clinic/user session vars), so appointments must admit it.
DROP POLICY appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() IN ('admin', 'auth')
);
DROP POLICY appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT WITH CHECK (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() IN ('admin', 'auth')
);
DROP POLICY appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() IN ('admin', 'auth')
);

-- Marketplace shows dentist profiles of published clinics to anonymous
-- visitors (spec §5 public policies).
DROP POLICY users_select ON users;
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app_user_id()
  OR app_role() IN ('admin', 'auth')
  OR (app_role() = 'staff' AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_user_id = users.id
          AND a.clinic_id = app_clinic_id()))
  OR (app_role() = 'staff' AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = users.id
          AND m.clinic_id = app_clinic_id()))
  OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN clinics c ON c.id = m.clinic_id
        WHERE m.user_id = users.id
          AND m.role = 'DENTIST'
          AND c.published = true)
);
```

Apply: `npx prisma migrate dev` — expect "Your database is now in sync".

- [ ] **Step 2: write the failing test** — `tests/availability.test.ts`

2027-01-15 and 2027-01-22 are Fridays; Europe/Belgrade is UTC+1 in January, so wall 09:00 = 08:00Z. `now` is injected to keep results deterministic.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { getAvailableSlots, AvailabilityError } from "@/lib/availability";

const NOW = new Date("2027-01-01T00:00:00Z");
let clinicSlug = "av-klinika";
let serviceId: string, drAId: string, drBId: string;

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: clinicSlug, name: "Av", city: "Prishtinë", address: "x",
            phone: "x", published: true },
  });
  const service = await direct.service.create({
    data: { clinicId: clinic.id, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 },
  });
  serviceId = service.id;
  // Dr A: linked to the service, works Fridays 09:00–17:00
  const uA = await direct.user.create({
    data: { name: "Dr A", email: "ava@x.com", passwordHash: "x" } });
  const mA = await direct.membership.create({
    data: { userId: uA.id, clinicId: clinic.id, role: "DENTIST" } });
  drAId = mA.id;
  await direct.dentistService.create({
    data: { membershipId: mA.id, serviceId: service.id } });
  await direct.schedule.create({
    data: { membershipId: mA.id, weekday: 5, startMin: 540, endMin: 1020 } });
  // Dr B: works Fridays too but NOT linked to the service
  const uB = await direct.user.create({
    data: { name: "Dr B", email: "avb@x.com", passwordHash: "x" } });
  const mB = await direct.membership.create({
    data: { userId: uB.id, clinicId: clinic.id, role: "DENTIST" } });
  drBId = mB.id;
  await direct.schedule.create({
    data: { membershipId: mB.id, weekday: 5, startMin: 540, endMin: 1020 } });
  // Dr A busy 10:00–11:00 wall on Jan 15 (= 09:00–10:00Z, CET)
  const patient = await direct.user.create({
    data: { name: "P", phone: "+38344555111" } });
  await direct.appointment.create({
    data: { clinicId: clinic.id, membershipId: mA.id, patientUserId: patient.id,
            serviceId: service.id, status: "CONFIRMED",
            startsAt: new Date("2027-01-15T09:00:00Z"),
            endsAt: new Date("2027-01-15T10:00:00Z") } });
  // clinic-wide closure on Jan 22
  await direct.scheduleException.create({
    data: { clinicId: clinic.id, membershipId: null,
            date: new Date("2027-01-22T00:00:00Z"), closed: true } });
});
afterAll(async () => { await direct.$disconnect(); });

describe("getAvailableSlots", () => {
  it("returns slots only for dentists linked to the service", async () => {
    const slots = await getAvailableSlots({
      clinicSlug, serviceId, dateISO: "2027-01-15", now: NOW });
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => s.membershipId))).toEqual(new Set([drAId]));
  });
  it("first slot is 09:00 wall = 08:00Z; busy 10:00–11:00 wall is excluded", async () => {
    const slots = await getAvailableSlots({
      clinicSlug, serviceId, dateISO: "2027-01-15", now: NOW });
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts[0]).toBe("2027-01-15T08:00:00.000Z");
    expect(starts).not.toContain("2027-01-15T09:00:00.000Z");
    expect(starts).not.toContain("2027-01-15T09:45:00.000Z"); // 30min overlaps busy
    expect(starts).toContain("2027-01-15T10:00:00.000Z");     // 11:00 wall, free
  });
  it("filters to a specific dentist when membershipId is given", async () => {
    const slots = await getAvailableSlots({
      clinicSlug, serviceId, membershipId: drBId, dateISO: "2027-01-15", now: NOW });
    expect(slots).toEqual([]); // Dr B is not linked to the service
  });
  it("clinic-wide closed exception empties the day", async () => {
    expect(await getAvailableSlots({
      clinicSlug, serviceId, dateISO: "2027-01-22", now: NOW })).toEqual([]);
  });
  it("rejects unpublished/unknown clinics", async () => {
    await expect(getAvailableSlots({
      clinicSlug: "nuk-ka", serviceId, dateISO: "2027-01-15", now: NOW }))
      .rejects.toThrow(AvailabilityError);
  });
  it("rejects malformed dates", async () => {
    await expect(getAvailableSlots({
      clinicSlug, serviceId, dateISO: "gabim", now: NOW }))
      .rejects.toThrow(AvailabilityError);
  });
});
```

- [ ] **Step 3: run, expect FAIL** (`npm run test -- tests/availability.test.ts` → "Cannot find package '@/lib/availability'")
- [ ] **Step 4: implement** — `src/lib/availability.ts`

```ts
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
```

- [ ] **Step 5: run, expect PASS**; also run the full suite (`npm run test`) to confirm the policy widening broke nothing.
- [ ] **Step 6: commit** `feat: availability lib and booking RLS widening`

---

### Task 2: Booking creation (status machine entry + concurrency safety)

**Files:**
- Create: `src/lib/booking.ts`
- Test: `tests/booking.test.ts`

**Interfaces:**
- Consumes: `getAvailableSlots` (Task 1).
- Produces: `createBooking(input: BookingInput): Promise<{ appointmentId: string; manageToken: string; status: "PENDING" | "CONFIRMED" }>` with `BookingInput = { clinicSlug: string; serviceId: string; membershipId: string; patientUserId: string; startsAtISO: string }`; throws `BookingError` with `code: "INVALID_INPUT" | "NOT_FOUND" | "SLOT_TAKEN"`. Also exports `isExclusionViolation(e: unknown): boolean` (Task 4 reuses it) and `clinicLocalDateISO(instant: Date, timezone: string): string`.

- [ ] **Step 1: write the failing test** — `tests/booking.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { createBooking, BookingError } from "@/lib/booking";

// Friday 2027-01-15; Europe/Belgrade is UTC+1 in January.
const SLOT_10_WALL = "2027-01-15T09:00:00.000Z";

let instantSlug = "bk-instant", approvalSlug = "bk-approval";
let instantServiceId: string, approvalServiceId: string;
let instantDrId: string, approvalDrId: string;
let patient1: string, patient2: string;

async function seedClinic(slug: string, bookingMode: "INSTANT" | "APPROVAL") {
  const clinic = await direct.clinic.create({
    data: { slug, name: slug, city: "P", address: "x", phone: "x",
            published: true, bookingMode },
  });
  const service = await direct.service.create({
    data: { clinicId: clinic.id, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 } });
  const u = await direct.user.create({
    data: { name: `Dr ${slug}`, email: `${slug}@x.com`, passwordHash: "x" } });
  const m = await direct.membership.create({
    data: { userId: u.id, clinicId: clinic.id, role: "DENTIST" } });
  await direct.schedule.create({
    data: { membershipId: m.id, weekday: 5, startMin: 540, endMin: 1020 } });
  return { serviceId: service.id, membershipId: m.id };
}

beforeAll(async () => {
  await truncateAll();
  const a = await seedClinic(instantSlug, "INSTANT");
  instantServiceId = a.serviceId; instantDrId = a.membershipId;
  const b = await seedClinic(approvalSlug, "APPROVAL");
  approvalServiceId = b.serviceId; approvalDrId = b.membershipId;
  patient1 = (await direct.user.create({
    data: { name: "P1", phone: "+38344600001" } })).id;
  patient2 = (await direct.user.create({
    data: { name: "P2", phone: "+38344600002" } })).id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("createBooking", () => {
  it("instant clinics confirm immediately and return a manage token", async () => {
    const r = await createBooking({
      clinicSlug: instantSlug, serviceId: instantServiceId,
      membershipId: instantDrId, patientUserId: patient1,
      startsAtISO: SLOT_10_WALL });
    expect(r.status).toBe("CONFIRMED");
    expect(r.manageToken).toBeTruthy();
    const appt = await direct.appointment.findUniqueOrThrow({
      where: { id: r.appointmentId } });
    expect(appt.endsAt.toISOString()).toBe("2027-01-15T09:30:00.000Z");
  });
  it("approval clinics create PENDING", async () => {
    const r = await createBooking({
      clinicSlug: approvalSlug, serviceId: approvalServiceId,
      membershipId: approvalDrId, patientUserId: patient1,
      startsAtISO: SLOT_10_WALL });
    expect(r.status).toBe("PENDING");
  });
  it("rejects a slot that is no longer free", async () => {
    await expect(createBooking({
      clinicSlug: instantSlug, serviceId: instantServiceId,
      membershipId: instantDrId, patientUserId: patient2,
      startsAtISO: SLOT_10_WALL }))
      .rejects.toThrow(BookingError); // taken in the first test
  });
  it("exactly one of two concurrent bookings of the same slot succeeds", async () => {
    const startsAtISO = "2027-01-15T13:00:00.000Z"; // 14:00 wall, free
    const results = await Promise.allSettled([
      createBooking({ clinicSlug: instantSlug, serviceId: instantServiceId,
        membershipId: instantDrId, patientUserId: patient1, startsAtISO }),
      createBooking({ clinicSlug: instantSlug, serviceId: instantServiceId,
        membershipId: instantDrId, patientUserId: patient2, startsAtISO }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    const err = (failed[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe("SLOT_TAKEN");
  });
  it("rejects garbage input", async () => {
    await expect(createBooking({
      clinicSlug: instantSlug, serviceId: "jo-uuid",
      membershipId: instantDrId, patientUserId: patient1,
      startsAtISO: SLOT_10_WALL }))
      .rejects.toThrow(BookingError);
  });
});
```

- [ ] **Step 2: run, expect FAIL** → **Step 3: implement** — `src/lib/booking.ts`

```ts
import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { getAvailableSlots } from "./availability";

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

  const clinic = await withDbContext({ role: "auth" }, (tx) =>
    tx.clinic.findUnique({ where: { slug: d.clinicSlug } }));
  if (!clinic?.published) throw new BookingError("NOT_FOUND");

  const dateISO = clinicLocalDateISO(startsAt, clinic.timezone);
  const slots = await getAvailableSlots({
    clinicSlug: d.clinicSlug, serviceId: d.serviceId,
    membershipId: d.membershipId, dateISO });
  const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw new BookingError("SLOT_TAKEN");

  try {
    const appt = await withDbContext(
      { role: "auth", userId: d.patientUserId },
      (tx) => tx.appointment.create({
        data: {
          clinicId: clinic.id, membershipId: d.membershipId,
          patientUserId: d.patientUserId, serviceId: d.serviceId,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
          status: clinic.bookingMode === "INSTANT" ? "CONFIRMED" : "PENDING",
        },
      }));
    return { appointmentId: appt.id, manageToken: appt.manageToken,
             status: appt.status as "PENDING" | "CONFIRMED" };
  } catch (e) {
    if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN");
    throw e;
  }
}
```

- [ ] **Step 4: run, expect PASS.** If the concurrency test's loser doesn't map to `SLOT_TAKEN`, print the caught error shape and adjust `isExclusionViolation` to match where adapter-pg puts the Postgres message — do not weaken the test.
- [ ] **Step 5: commit** `feat: booking creation with concurrency-safe slot taking`

---

### Task 3: Notifications outbox

**Files:**
- Create: `src/lib/notify.ts`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Consumes: `SmsProvider` from `src/lib/sms` (`send(to, message): Promise<{ providerRef: string }>`).
- Produces: `notifyAppointment(template: AppointmentTemplate, appointmentId: string, provider?: SmsProvider)` with `AppointmentTemplate = "booking_confirmed" | "booking_pending" | "booking_declined" | "booking_cancelled" | "booking_rescheduled"`. Writes one `notifications` row, sends, marks `SENT` (+providerRef) or `FAILED`. Returns the final row or `null` when the patient has no phone. Tasks 4, 5, 7 call this.

- [ ] **Step 1: write the failing test** — `tests/notify.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { notifyAppointment } from "@/lib/notify";

let appointmentId: string;

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "nt-klinika", name: "Klinika NT", city: "P", address: "x",
            phone: "x", published: true } });
  const service = await direct.service.create({
    data: { clinicId: clinic.id, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 } });
  const du = await direct.user.create({
    data: { name: "Dr", email: "nt-dr@x.com", passwordHash: "x" } });
  const m = await direct.membership.create({
    data: { userId: du.id, clinicId: clinic.id, role: "DENTIST" } });
  const patient = await direct.user.create({
    data: { name: "Pacienti", phone: "+38344700001", locale: "sq" } });
  const appt = await direct.appointment.create({
    data: { clinicId: clinic.id, membershipId: m.id, patientUserId: patient.id,
            serviceId: service.id, status: "CONFIRMED",
            startsAt: new Date("2027-01-15T09:00:00Z"),
            endsAt: new Date("2027-01-15T09:30:00Z") } });
  appointmentId = appt.id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("notifyAppointment", () => {
  it("writes a SENT outbox row and sends via the provider", async () => {
    const sent: { to: string; message: string }[] = [];
    const fake = { async send(to: string, message: string) {
      sent.push({ to, message }); return { providerRef: "fake-1" }; } };
    const row = await notifyAppointment("booking_confirmed", appointmentId, fake);
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe("+38344700001");
    expect(sent[0].message).toContain("Klinika NT");
    expect(sent[0].message).toContain("/manage/");
    expect(row?.status).toBe("SENT");
    expect(row?.providerRef).toBe("fake-1");
  });
  it("marks the row FAILED when the provider throws", async () => {
    const broken = { async send(): Promise<{ providerRef: string }> {
      throw new Error("down"); } };
    const row = await notifyAppointment("booking_cancelled", appointmentId, broken);
    expect(row?.status).toBe("FAILED");
    expect(row?.sentAt).toBeNull();
  });
});
```

- [ ] **Step 2: run, expect FAIL** → **Step 3: implement** — `src/lib/notify.ts`

```ts
import { withDbContext } from "./tenant-db";
import { getSmsProvider, type SmsProvider } from "./sms";

export type AppointmentTemplate =
  | "booking_confirmed" | "booking_pending" | "booking_declined"
  | "booking_cancelled" | "booking_rescheduled";

type Vars = { clinic: string; when: string; link: string };
const texts: Record<AppointmentTemplate, Record<"sq" | "en", (p: Vars) => string>> = {
  booking_confirmed: {
    sq: (p) => `Dentbook: termini u konfirmua te ${p.clinic} më ${p.when}. Menaxho: ${p.link}`,
    en: (p) => `Dentbook: your appointment at ${p.clinic} on ${p.when} is confirmed. Manage: ${p.link}`,
  },
  booking_pending: {
    sq: (p) => `Dentbook: kërkesa u dërgua te ${p.clinic} për ${p.when}. Statusi: ${p.link}`,
    en: (p) => `Dentbook: your request to ${p.clinic} for ${p.when} was sent. Status: ${p.link}`,
  },
  booking_declined: {
    sq: (p) => `Dentbook: ${p.clinic} nuk e pranoi kërkesën për ${p.when}.`,
    en: (p) => `Dentbook: ${p.clinic} declined your request for ${p.when}.`,
  },
  booking_cancelled: {
    sq: (p) => `Dentbook: termini te ${p.clinic} më ${p.when} u anulua.`,
    en: (p) => `Dentbook: your appointment at ${p.clinic} on ${p.when} was cancelled.`,
  },
  booking_rescheduled: {
    sq: (p) => `Dentbook: termini te ${p.clinic} u zhvendos më ${p.when}. Menaxho: ${p.link}`,
    en: (p) => `Dentbook: your appointment at ${p.clinic} moved to ${p.when}. Manage: ${p.link}`,
  },
};

/** Outbox-backed SMS: one notifications row per send, SENT or FAILED. */
export async function notifyAppointment(
  template: AppointmentTemplate,
  appointmentId: string,
  provider: SmsProvider = getSmsProvider(),
) {
  const appt = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true, clinic: true },
    }));
  if (!appt?.patient.phone) return null;
  const phone = appt.patient.phone;

  const locale = appt.patient.locale === "en" ? "en" : "sq";
  const when = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sq-AL", {
    timeZone: appt.clinic.timezone, dateStyle: "short", timeStyle: "short",
  }).format(appt.startsAt);
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/manage/${appt.manageToken}`;
  const message = texts[template][locale]({ clinic: appt.clinic.name, when, link });

  const row = await withDbContext({ role: "auth" }, (tx) =>
    tx.notification.create({
      data: { clinicId: appt.clinicId, channel: "SMS", recipient: phone,
              template, payload: { appointmentId }, scheduledAt: new Date() },
    }));
  try {
    const { providerRef } = await provider.send(phone, message);
    return await withDbContext({ role: "auth" }, (tx) =>
      tx.notification.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: new Date(), providerRef },
      }));
  } catch {
    return await withDbContext({ role: "auth" }, (tx) =>
      tx.notification.update({
        where: { id: row.id }, data: { status: "FAILED" },
      }));
  }
}
```

- [ ] **Step 4: run, expect PASS** → **Step 5: commit** `feat: notifications outbox with SMS dispatch`

---

### Task 4: Manage-token lib (login-free cancel/reschedule)

**Files:**
- Create: `src/lib/manage.ts`
- Test: `tests/manage.test.ts`

**Interfaces:**
- Consumes: `getAvailableSlots` (Task 1), `isExclusionViolation`, `clinicLocalDateISO` (Task 2), `notifyAppointment` (Task 3).
- Produces:
  - `getAppointmentByToken(token: string, now?: Date)` → `{ appointment: <appointment with clinic, service, membership.user includes>, cancellable: boolean } | null` (null once `endsAt < now` — manage links expire when the appointment ends, spec §9).
  - `cancelViaToken(token: string, now?: Date)` and `rescheduleViaToken(token: string, newStartsAtISO: string, now?: Date)`; both throw `ManageError` with `code: "NOT_FOUND" | "NOT_ACTIVE" | "WINDOW_PASSED" | "SLOT_TAKEN"`. Tasks 7–8 call these.

- [ ] **Step 1: write the failing test** — `tests/manage.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { getAppointmentByToken, cancelViaToken, rescheduleViaToken,
         ManageError } from "@/lib/manage";

// Friday 2027-01-15, dentist works 09:00–17:00 wall (08:00–16:00Z in CET).
const NOW = new Date("2027-01-10T00:00:00Z"); // 5 days before → outside 24h window

let clinicSlug = "mg-klinika";
let serviceId: string, drId: string, patientId: string;

async function makeAppt(startsAtZ: string, endsAtZ: string) {
  return direct.appointment.create({
    data: { clinicId: (await direct.clinic.findUniqueOrThrow({
              where: { slug: clinicSlug } })).id,
            membershipId: drId, patientUserId: patientId, serviceId,
            status: "CONFIRMED",
            startsAt: new Date(startsAtZ), endsAt: new Date(endsAtZ) } });
}

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: clinicSlug, name: "Mg", city: "P", address: "x", phone: "x",
            published: true, cancellationWindowHours: 24 } });
  const service = await direct.service.create({
    data: { clinicId: clinic.id, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 } });
  serviceId = service.id;
  const du = await direct.user.create({
    data: { name: "Dr", email: "mg-dr@x.com", passwordHash: "x" } });
  const m = await direct.membership.create({
    data: { userId: du.id, clinicId: clinic.id, role: "DENTIST" } });
  drId = m.id;
  await direct.schedule.create({
    data: { membershipId: m.id, weekday: 5, startMin: 540, endMin: 1020 } });
  patientId = (await direct.user.create({
    data: { name: "P", phone: "+38344800001" } })).id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("getAppointmentByToken", () => {
  it("resolves an active future appointment as cancellable", async () => {
    const a = await makeAppt("2027-01-15T08:00:00Z", "2027-01-15T08:30:00Z");
    const found = await getAppointmentByToken(a.manageToken, NOW);
    expect(found?.appointment.id).toBe(a.id);
    expect(found?.cancellable).toBe(true);
  });
  it("is null for unknown tokens and for ended appointments", async () => {
    expect(await getAppointmentByToken("00000000-0000-0000-0000-000000000000", NOW))
      .toBeNull();
    const past = await makeAppt("2027-01-08T08:00:00Z", "2027-01-08T08:30:00Z");
    expect(await getAppointmentByToken(past.manageToken, NOW)).toBeNull();
  });
});

describe("cancelViaToken", () => {
  it("cancels inside the allowed window", async () => {
    const a = await makeAppt("2027-01-15T09:00:00Z", "2027-01-15T09:30:00Z");
    const updated = await cancelViaToken(a.manageToken, NOW);
    expect(updated.status).toBe("CANCELLED");
  });
  it("refuses when the cancellation window has passed", async () => {
    const a = await makeAppt("2027-01-15T10:00:00Z", "2027-01-15T10:30:00Z");
    const nearNow = new Date("2027-01-15T00:00:00Z"); // 10h before < 24h window
    await expect(cancelViaToken(a.manageToken, nearNow))
      .rejects.toThrow(ManageError);
  });
});

describe("rescheduleViaToken", () => {
  it("moves the appointment to a free slot and keeps the token", async () => {
    const a = await makeAppt("2027-01-15T11:00:00Z", "2027-01-15T11:30:00Z");
    const updated = await rescheduleViaToken(
      a.manageToken, "2027-01-15T13:00:00.000Z", NOW);
    expect(updated.startsAt.toISOString()).toBe("2027-01-15T13:00:00.000Z");
    expect(updated.manageToken).toBe(a.manageToken);
  });
  it("refuses a taken slot", async () => {
    const blocker = await makeAppt("2027-01-15T14:00:00Z", "2027-01-15T14:30:00Z");
    const a = await makeAppt("2027-01-15T15:00:00Z", "2027-01-15T15:30:00Z");
    await expect(rescheduleViaToken(a.manageToken, "2027-01-15T14:00:00.000Z", NOW))
      .rejects.toThrow(ManageError);
  });
});
```

- [ ] **Step 2: run, expect FAIL** → **Step 3: implement** — `src/lib/manage.ts`

```ts
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
```

Known v1 limitation (accept it): rescheduling to a time adjacent to the appointment's *own* current interval can be refused because availability counts the appointment itself as busy. Note it; don't engineer around it.

- [ ] **Step 4: run, expect PASS** → **Step 5: commit** `feat: manage-token cancel and reschedule`

---

### Task 5: Staff appointment actions (status machine)

**Files:**
- Create: `src/lib/appointment-actions.ts`
- Test: `tests/appointment-actions.test.ts`

**Interfaces:**
- Consumes: `notifyAppointment` (Task 3).
- Produces (all take `ctx: { userId: string; clinicId: string }` first):
  `acceptAppointment(ctx, id)` PENDING→CONFIRMED, `declineAppointment(ctx, id)` PENDING→DECLINED, `cancelAppointmentByStaff(ctx, id)` PENDING|CONFIRMED→CANCELLED, `completeAppointment(ctx, id)` CONFIRMED→COMPLETED, `markNoShow(ctx, id)` CONFIRMED→NO_SHOW, `expireStalePending(ctx, now?)` bulk PENDING(started in past)→DECLINED. Throws `TransitionError` with `code: "NOT_FOUND" | "INVALID_TRANSITION"`. Task 9 calls these.

- [ ] **Step 1: write the failing test** — `tests/appointment-actions.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { acceptAppointment, declineAppointment, cancelAppointmentByStaff,
         completeAppointment, expireStalePending,
         TransitionError } from "@/lib/appointment-actions";
import type { AppointmentStatus } from "@/generated/prisma/client";

let ctx: { userId: string; clinicId: string };
let otherCtx: { userId: string; clinicId: string };
let drId: string, serviceId: string, patientId: string, clinicId: string;

async function makeAppt(status: AppointmentStatus, startsAtZ = "2027-03-05T09:00:00Z") {
  return direct.appointment.create({
    data: { clinicId, membershipId: drId, patientUserId: patientId, serviceId,
            status, startsAt: new Date(startsAtZ),
            endsAt: new Date(new Date(startsAtZ).getTime() + 30 * 60000) } });
}

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "aa-klinika", name: "Aa", city: "P", address: "x", phone: "x" } });
  clinicId = clinic.id;
  const owner = await direct.user.create({
    data: { name: "O", email: "aa-o@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId, role: "OWNER" } });
  ctx = { userId: owner.id, clinicId };
  const du = await direct.user.create({
    data: { name: "Dr", email: "aa-dr@x.com", passwordHash: "x" } });
  drId = (await direct.membership.create({
    data: { userId: du.id, clinicId, role: "DENTIST" } })).id;
  serviceId = (await direct.service.create({
    data: { clinicId, nameSq: "P", nameEn: "C", durationMin: 30, priceEur: 20 } })).id;
  patientId = (await direct.user.create({
    data: { name: "P", phone: "+38344900001" } })).id;
  // a second clinic to prove tenant isolation of transitions
  const c2 = await direct.clinic.create({
    data: { slug: "aa-tjeter", name: "T", city: "P", address: "x", phone: "x" } });
  const o2 = await direct.user.create({
    data: { name: "O2", email: "aa-o2@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: o2.id, clinicId: c2.id, role: "OWNER" } });
  otherCtx = { userId: o2.id, clinicId: c2.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("staff transitions", () => {
  it("accepts a pending request", async () => {
    const a = await makeAppt("PENDING");
    expect((await acceptAppointment(ctx, a.id)).status).toBe("CONFIRMED");
  });
  it("declines a pending request", async () => {
    const a = await makeAppt("PENDING", "2027-03-05T10:00:00Z");
    expect((await declineAppointment(ctx, a.id)).status).toBe("DECLINED");
  });
  it("cancels a confirmed appointment", async () => {
    const a = await makeAppt("CONFIRMED", "2027-03-05T11:00:00Z");
    expect((await cancelAppointmentByStaff(ctx, a.id)).status).toBe("CANCELLED");
  });
  it("completes only from CONFIRMED", async () => {
    const a = await makeAppt("PENDING", "2027-03-05T12:00:00Z");
    await expect(completeAppointment(ctx, a.id)).rejects.toThrow(TransitionError);
  });
  it("cannot touch another clinic's appointment (RLS → NOT_FOUND)", async () => {
    const a = await makeAppt("PENDING", "2027-03-05T13:00:00Z");
    await expect(acceptAppointment(otherCtx, a.id)).rejects.toThrow(TransitionError);
  });
});

describe("expireStalePending", () => {
  it("declines pending requests whose start has passed", async () => {
    const stale = await makeAppt("PENDING", "2027-03-01T09:00:00Z");
    const fresh = await makeAppt("PENDING", "2027-03-09T09:00:00Z");
    await expireStalePending(ctx, new Date("2027-03-05T00:00:00Z"));
    expect((await direct.appointment.findUniqueOrThrow({
      where: { id: stale.id } })).status).toBe("DECLINED");
    expect((await direct.appointment.findUniqueOrThrow({
      where: { id: fresh.id } })).status).toBe("PENDING");
  });
});
```

- [ ] **Step 2: run, expect FAIL** → **Step 3: implement** — `src/lib/appointment-actions.ts`

```ts
import { withDbContext } from "./tenant-db";
import { notifyAppointment } from "./notify";
import type { AppointmentStatus } from "@/generated/prisma/client";

export class TransitionError extends Error {
  constructor(public code: "NOT_FOUND" | "INVALID_TRANSITION") { super(code); }
}

type StaffCtx = { userId: string; clinicId: string };
const ctxOf = (c: StaffCtx) =>
  ({ role: "staff" as const, userId: c.userId, clinicId: c.clinicId });

/** target status → statuses it may come from (spec §6 status machine). */
const allowedFrom: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  CONFIRMED: ["PENDING"],
  DECLINED: ["PENDING"],
  CANCELLED: ["PENDING", "CONFIRMED"],
  COMPLETED: ["CONFIRMED"],
  NO_SHOW: ["CONFIRMED"],
};

async function transition(ctx: StaffCtx, id: string, to: AppointmentStatus) {
  return withDbContext(ctxOf(ctx), async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id } });
    if (!appt) throw new TransitionError("NOT_FOUND"); // RLS hides other tenants
    if (!allowedFrom[to]?.includes(appt.status)) {
      throw new TransitionError("INVALID_TRANSITION");
    }
    return tx.appointment.update({ where: { id }, data: { status: to } });
  });
}

export async function acceptAppointment(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "CONFIRMED");
  await notifyAppointment("booking_confirmed", a.id);
  return a;
}

export async function declineAppointment(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "DECLINED");
  await notifyAppointment("booking_declined", a.id);
  return a;
}

export async function cancelAppointmentByStaff(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "CANCELLED");
  await notifyAppointment("booking_cancelled", a.id);
  return a;
}

export async function completeAppointment(ctx: StaffCtx, id: string) {
  return transition(ctx, id, "COMPLETED");
}

export async function markNoShow(ctx: StaffCtx, id: string) {
  return transition(ctx, id, "NO_SHOW");
}

/** Pending requests whose start passed without a decision expire as DECLINED. */
export async function expireStalePending(ctx: StaffCtx, now = new Date()) {
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.appointment.updateMany({
      where: { clinicId: ctx.clinicId, status: "PENDING", startsAt: { lt: now } },
      data: { status: "DECLINED" },
    }));
}
```

- [ ] **Step 4: run, expect PASS** → **Step 5: commit** `feat: staff appointment status transitions`

---

### Task 6: Marketplace pages

**Files:**
- Create: `src/app/[locale]/clinics/page.tsx`, `src/app/[locale]/clinics/[slug]/page.tsx`
- Modify: `src/app/[locale]/page.tsx` (CTA link), both message files

**Interfaces:**
- Consumes: `withDbContext` with `role: "public"` only.
- Produces: routes `/clinics` and `/clinics/[slug]`; the profile page links to `/clinics/[slug]/book?serviceId=...` (Task 7's route).

- [ ] **Step 1: list page** — `src/app/[locale]/clinics/page.tsx`

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { withDbContext } from "@/lib/tenant-db";

export default async function ClinicsPage({
  searchParams,
}: { searchParams: Promise<{ city?: string }> }) {
  const t = await getTranslations("Clinics");
  const { city } = await searchParams;
  const all = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findMany({ where: { published: true }, orderBy: { name: "asc" } }));
  const cities = [...new Set(all.map((c) => c.city))].sort();
  const clinics = city ? all.filter((c) => c.city === city) : all;

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/clinics"
              className={`rounded-full border px-3 py-1 text-sm ${!city ? "bg-sky-600 text-white" : ""}`}>
          {t("allCities")}
        </Link>
        {cities.map((c) => (
          <Link key={c} href={`/clinics?city=${encodeURIComponent(c)}`}
                className={`rounded-full border px-3 py-1 text-sm ${city === c ? "bg-sky-600 text-white" : ""}`}>
            {c}
          </Link>
        ))}
      </div>
      {clinics.length === 0 && <p className="text-gray-500">{t("empty")}</p>}
      <ul className="flex flex-col gap-3">
        {clinics.map((c) => (
          <li key={c.id}>
            <Link href={`/clinics/${c.slug}`}
                  className="block rounded border p-4 hover:bg-gray-50">
              <p className="font-semibold">{c.name}</p>
              <p className="text-sm text-gray-500">{c.city} · {c.address}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: profile page** — `src/app/[locale]/clinics/[slug]/page.tsx`

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { withDbContext } from "@/lib/tenant-db";

export default async function ClinicProfilePage({
  params,
}: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  const t = await getTranslations("Clinics");
  const clinic = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findFirst({
      where: { slug, published: true },
      include: {
        services: { where: { active: true }, orderBy: { nameSq: "asc" } },
        memberships: { where: { role: "DENTIST" },
                       include: { user: true }, orderBy: { createdAt: "asc" } },
      },
    }));
  if (!clinic) notFound();
  const about = locale === "en" ? clinic.aboutEn : clinic.aboutSq;

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="text-3xl font-bold" style={{ color: clinic.brandColor }}>
        {clinic.name}
      </h1>
      <p className="mb-1 text-gray-600">{clinic.city} · {clinic.address}</p>
      <p className="mb-6 text-gray-600">{clinic.phone}</p>
      {about && <p className="mb-8 whitespace-pre-line">{about}</p>}

      <h2 className="mb-2 text-xl font-semibold">{t("dentists")}</h2>
      <ul className="mb-8 flex flex-col gap-2">
        {clinic.memberships.map((m) => (
          <li key={m.id} className="rounded border p-3">
            {/* user can be null only if RLS blocks it — render defensively */}
            <p className="font-medium">{m.user?.name}{m.title ? ` · ${m.title}` : ""}</p>
            {m.bio && <p className="text-sm text-gray-500">{m.bio}</p>}
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-xl font-semibold">{t("services")}</h2>
      <ul className="flex flex-col gap-2">
        {clinic.services.map((s) => (
          <li key={s.id}
              className="flex items-center justify-between rounded border p-3">
            <span>
              {locale === "en" ? s.nameEn : s.nameSq}
              <span className="ml-2 text-sm text-gray-500">
                {s.durationMin} min · {String(s.priceEur)} €
              </span>
            </span>
            <Link href={`/clinics/${clinic.slug}/book?serviceId=${s.id}`}
                  className="rounded bg-sky-600 px-4 py-2 text-sm text-white">
              {t("book")}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: point the home CTA at the marketplace** — in `src/app/[locale]/page.tsx` replace the `<a href="#">` element with:

```tsx
      <a href="/clinics" className="rounded-lg bg-sky-600 px-6 py-3 text-white">
        {t("cta")}
      </a>
```

- [ ] **Step 4: strings** — add to `src/messages/sq.json` (top level, before `"Common"`):

```json
  "Clinics": {
    "title": "Klinikat",
    "allCities": "Të gjitha qytetet",
    "empty": "Nuk u gjet asnjë klinikë",
    "dentists": "Dentistët",
    "services": "Shërbimet",
    "book": "Rezervo"
  },
```

and to `en.json`:

```json
  "Clinics": {
    "title": "Clinics",
    "allCities": "All cities",
    "empty": "No clinics found",
    "dentists": "Dentists",
    "services": "Services",
    "book": "Book"
  },
```

- [ ] **Step 5: verify** — `npm run build` clean; `npm run dev`, open `http://localhost:3000/clinics` → two seeded published clinics listed (Smile Peja hidden); profile shows dentist names (proves the `users_select` public clause) and Book buttons.
- [ ] **Step 6: commit** `feat: marketplace clinic list and profile pages`

---

### Task 7: Booking wizard with OTP

**Files:**
- Create: `src/app/[locale]/clinics/[slug]/book/page.tsx`
- Modify: `.env` (add `APP_URL=http://localhost:3000`), both message files

**Interfaces:**
- Consumes: `getAvailableSlots` (Task 1), `createBooking`/`BookingError` (Task 2), `notifyAppointment` (Task 3), `rescheduleViaToken`/`ManageError` (Task 4), `requestOtp`/`OtpError` from `src/lib/otp.ts`, `auth`/`signIn` from `@/auth`.
- Produces: route `/clinics/[slug]/book`. Query params: `serviceId` → `membershipId` (`any` allowed) → `date` (YYYY-MM-DD) → `startsAt` (URL-encoded ISO; slot links also pin `membershipId` to the concrete dentist) → identity (`phone`+`name` form, then `sent=1` + `code` form). `reschedule=<manageToken>` switches the final action to reschedule (token is the credential — no OTP). Success → `/manage/<token>?booked=1` or `?updated=1`.

- [ ] **Step 1: add `APP_URL=http://localhost:3000` to `.env`** (manage links in SMS need it).
- [ ] **Step 2: the page** — `src/app/[locale]/clinics/[slug]/book/page.tsx`

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations, getFormatter } from "next-intl/server";
import { auth, signIn } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { getAvailableSlots } from "@/lib/availability";
import { createBooking, BookingError } from "@/lib/booking";
import { rescheduleViaToken, ManageError } from "@/lib/manage";
import { requestOtp, OtpError } from "@/lib/otp";
import { notifyAppointment } from "@/lib/notify";

type Query = {
  serviceId?: string; membershipId?: string; date?: string; startsAt?: string;
  phone?: string; name?: string; sent?: string; error?: string; reschedule?: string;
};

export default async function BookPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<Query>;
}) {
  const { slug, locale } = await params;
  const q = await searchParams;
  const t = await getTranslations("Book");
  const format = await getFormatter();
  const session = await auth();
  const isPatient = session?.user?.kind === "patient";

  const clinic = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findFirst({
      where: { slug, published: true },
      include: {
        services: { where: { active: true }, orderBy: { nameSq: "asc" } },
        memberships: { where: { role: "DENTIST" },
                       include: { user: true }, orderBy: { createdAt: "asc" } },
      },
    }));
  if (!clinic) notFound();

  const service = clinic.services.find((s) => s.id === q.serviceId);
  const base = `/clinics/${slug}/book`;
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
      serviceId: q.serviceId, membershipId: q.membershipId, date: q.date,
      startsAt: q.startsAt, reschedule: q.reschedule, ...extra,
    })) if (v) p.set(k, v);
    return `${base}?${p.toString()}`;
  };

  // ---- server actions ----------------------------------------------------
  async function requestOtpAction(formData: FormData) {
    "use server";
    const f = (k: string) => String(formData.get(k) ?? "");
    const back = f("back");
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    try {
      await requestOtp(f("phone"), ip);
    } catch (e) {
      redirect(`${back}&error=${e instanceof OtpError ? e.code : "UNKNOWN"}`);
    }
    redirect(`${back}&phone=${encodeURIComponent(f("phone"))}&name=${encodeURIComponent(f("name"))}&sent=1`);
  }

  async function confirmAction(formData: FormData) {
    "use server";
    const f = (k: string) => String(formData.get(k) ?? "");
    const back = f("back");
    let userId: string | undefined;
    const s = await auth();
    if (s?.user?.kind === "patient") {
      userId = s.user.id;
    } else {
      try {
        await signIn("patient-otp", {
          phone: f("phone"), code: f("code"), name: f("name"), redirect: false });
      } catch {
        redirect(`${back}&phone=${encodeURIComponent(f("phone"))}&name=${encodeURIComponent(f("name"))}&sent=1&error=INVALID_CODE`);
      }
      userId = (await auth())?.user?.id;
    }
    if (!userId) redirect(`${back}&error=UNKNOWN`);

    let dest = "";
    try {
      const r = await createBooking({
        clinicSlug: f("slug"), serviceId: f("serviceId"),
        membershipId: f("membershipId"), patientUserId: userId!,
        startsAtISO: f("startsAt") });
      await notifyAppointment(
        r.status === "CONFIRMED" ? "booking_confirmed" : "booking_pending",
        r.appointmentId);
      dest = `/manage/${r.manageToken}?booked=1`;
    } catch (e) {
      redirect(`${back}&error=${e instanceof BookingError ? e.code : "UNKNOWN"}`);
    }
    redirect(dest);
  }

  async function rescheduleAction(formData: FormData) {
    "use server";
    const f = (k: string) => String(formData.get(k) ?? "");
    try {
      await rescheduleViaToken(f("reschedule"), f("startsAt"));
    } catch (e) {
      redirect(`${f("back")}&error=${e instanceof ManageError ? e.code : "UNKNOWN"}`);
    }
    redirect(`/manage/${f("reschedule")}?updated=1`);
  }
  // -------------------------------------------------------------------------

  const sName = (s: { nameSq: string; nameEn: string }) =>
    locale === "en" ? s.nameEn : s.nameSq;

  let body: React.ReactNode;
  if (!service) {
    // step 1: choose service
    body = (
      <ul className="flex flex-col gap-2">
        {clinic.services.map((s) => (
          <li key={s.id}>
            <Link href={keep({ serviceId: s.id })}
                  className="block rounded border p-3 hover:bg-gray-50">
              {sName(s)}
              <span className="ml-2 text-sm text-gray-500">
                {s.durationMin} min · {String(s.priceEur)} €
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  } else if (!q.membershipId) {
    // step 2: choose dentist (or any)
    body = (
      <ul className="flex flex-col gap-2">
        <li>
          <Link href={keep({ membershipId: "any" })}
                className="block rounded border p-3 font-medium hover:bg-gray-50">
            {t("anyDentist")}
          </Link>
        </li>
        {clinic.memberships.map((m) => (
          <li key={m.id}>
            <Link href={keep({ membershipId: m.id })}
                  className="block rounded border p-3 hover:bg-gray-50">
              {m.user?.name}{m.title ? ` · ${m.title}` : ""}
            </Link>
          </li>
        ))}
      </ul>
    );
  } else if (!q.date) {
    // step 3: pick a date (GET form back onto this page)
    body = (
      <form action={base} method="get" className="flex max-w-xs flex-col gap-2">
        {q.serviceId && <input type="hidden" name="serviceId" value={q.serviceId} />}
        <input type="hidden" name="membershipId" value={q.membershipId} />
        {q.reschedule && <input type="hidden" name="reschedule" value={q.reschedule} />}
        <input name="date" type="date" required className="rounded border p-2" />
        <button className="rounded bg-sky-600 p-2 text-white">{t("showSlots")}</button>
      </form>
    );
  } else if (!q.startsAt) {
    // step 4: pick a slot
    const slots = await getAvailableSlots({
      clinicSlug: slug, serviceId: service.id,
      membershipId: q.membershipId === "any" ? null : q.membershipId,
      dateISO: q.date });
    body = (
      <div>
        {slots.length === 0 && <p className="text-gray-500">{t("noSlots")}</p>}
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <Link key={`${s.membershipId}-${s.startsAt.toISOString()}`}
                  href={keep({ startsAt: s.startsAt.toISOString(),
                               membershipId: s.membershipId })}
                  className="rounded border px-3 py-2 font-mono text-sm hover:bg-gray-50">
              {format.dateTime(s.startsAt, {
                hour: "2-digit", minute: "2-digit",
                timeZone: clinic.timezone })}
            </Link>
          ))}
        </div>
        <p className="mt-4">
          <Link href={keep({ date: "" })} className="text-sm text-sky-700 underline">
            {t("otherDate")}
          </Link>
        </p>
      </div>
    );
  } else {
    // step 5: confirm — reschedule needs no identity; new bookings need OTP
    const back = keep({});
    const when = format.dateTime(new Date(q.startsAt), {
      dateStyle: "medium", timeStyle: "short", timeZone: clinic.timezone });
    const summary = (
      <p className="mb-4 rounded bg-gray-50 p-3">
        {sName(service)} — <span className="font-mono">{when}</span>
      </p>
    );
    if (q.reschedule) {
      body = (
        <div>
          {summary}
          <form action={rescheduleAction}>
            <input type="hidden" name="reschedule" value={q.reschedule} />
            <input type="hidden" name="startsAt" value={q.startsAt} />
            <input type="hidden" name="back" value={back} />
            <button className="rounded bg-sky-600 p-2 px-6 text-white">
              {t("confirmReschedule")}
            </button>
          </form>
        </div>
      );
    } else if (isPatient || q.sent) {
      body = (
        <div>
          {summary}
          <form action={confirmAction} className="flex max-w-xs flex-col gap-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="membershipId" value={q.membershipId} />
            <input type="hidden" name="startsAt" value={q.startsAt} />
            <input type="hidden" name="back" value={back} />
            {!isPatient && (
              <>
                <input type="hidden" name="phone" value={q.phone ?? ""} />
                <input type="hidden" name="name" value={q.name ?? ""} />
                <p className="text-sm text-gray-600">{t("codeSentTo", { phone: q.phone ?? "" })}</p>
                <input name="code" required maxLength={6} placeholder={t("code")}
                       className="rounded border p-2 font-mono" />
              </>
            )}
            <button className="rounded bg-sky-600 p-2 text-white">{t("confirm")}</button>
          </form>
        </div>
      );
    } else {
      body = (
        <div>
          {summary}
          <form action={requestOtpAction} className="flex max-w-xs flex-col gap-2">
            <input type="hidden" name="back" value={back} />
            <input name="name" required placeholder={t("yourName")}
                   className="rounded border p-2" />
            <input name="phone" type="tel" required placeholder={t("yourPhone")}
                   className="rounded border p-2" />
            <button className="rounded bg-sky-600 p-2 text-white">{t("sendCode")}</button>
          </form>
        </div>
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="mb-1 text-2xl font-bold">
        {q.reschedule ? t("rescheduleTitle") : t("title")}
      </h1>
      <p className="mb-6 text-gray-600">{clinic.name}</p>
      {q.error && (
        <p className="mb-4 text-sm text-red-600">{t(`errors.${q.error}` as never)}</p>
      )}
      {body}
    </main>
  );
}
```

- [ ] **Step 3: strings** — `sq.json`:

```json
  "Book": {
    "title": "Rezervo termin",
    "rescheduleTitle": "Zhvendos terminin",
    "anyDentist": "Cilido dentist i lirë",
    "showSlots": "Shiko oraret e lira",
    "noSlots": "Nuk ka orare të lira për këtë ditë",
    "otherDate": "Zgjidh datë tjetër",
    "yourName": "Emri juaj",
    "yourPhone": "Numri i telefonit",
    "sendCode": "Dërgo kodin",
    "codeSentTo": "Kodi u dërgua në {phone}",
    "code": "Kodi 6-shifror",
    "confirm": "Konfirmo terminin",
    "confirmReschedule": "Konfirmo zhvendosjen",
    "errors": {
      "INVALID_CODE": "Kod i gabuar",
      "EXPIRED": "Kodi ka skaduar — kërko një të ri",
      "TOO_MANY_ATTEMPTS": "Shumë tentime — kërko kod të ri",
      "RATE_LIMITED_PHONE": "Shumë kërkesa — provo më vonë",
      "RATE_LIMITED_IP": "Shumë kërkesa — provo më vonë",
      "SLOT_TAKEN": "Ky orar sapo u zu — zgjidh një tjetër",
      "WINDOW_PASSED": "Afati i ndryshimit ka kaluar",
      "NOT_ACTIVE": "Ky termin nuk është më aktiv",
      "NOT_FOUND": "Termini nuk u gjet",
      "INVALID_INPUT": "Të dhëna të pavlefshme",
      "UNKNOWN": "Gabim i papritur"
    }
  },
```

`en.json`:

```json
  "Book": {
    "title": "Book an appointment",
    "rescheduleTitle": "Reschedule appointment",
    "anyDentist": "Any available dentist",
    "showSlots": "See free slots",
    "noSlots": "No free slots on this day",
    "otherDate": "Pick another date",
    "yourName": "Your name",
    "yourPhone": "Phone number",
    "sendCode": "Send code",
    "codeSentTo": "Code sent to {phone}",
    "code": "6-digit code",
    "confirm": "Confirm booking",
    "confirmReschedule": "Confirm reschedule",
    "errors": {
      "INVALID_CODE": "Wrong code",
      "EXPIRED": "Code expired — request a new one",
      "TOO_MANY_ATTEMPTS": "Too many attempts — request a new code",
      "RATE_LIMITED_PHONE": "Too many requests — try again later",
      "RATE_LIMITED_IP": "Too many requests — try again later",
      "SLOT_TAKEN": "That slot was just taken — pick another",
      "WINDOW_PASSED": "The change window has passed",
      "NOT_ACTIVE": "This appointment is no longer active",
      "NOT_FOUND": "Appointment not found",
      "INVALID_INPUT": "Invalid input",
      "UNKNOWN": "Unexpected error"
    }
  },
```

- [ ] **Step 4: verify** — `npm run build` clean. Manual smoke happens in Task 8 Step 4 once the manage page (the redirect target) exists.
- [ ] **Step 5: commit** `feat: patient booking wizard with OTP verification`

---

### Task 8: Manage page

**Files:**
- Create: `src/app/[locale]/manage/[token]/page.tsx`
- Modify: both message files

**Interfaces:**
- Consumes: `getAppointmentByToken`, `cancelViaToken`, `ManageError` (Task 4).
- Produces: route `/manage/[token]` — the target of SMS links and booking redirects.

- [ ] **Step 1: the page** — `src/app/[locale]/manage/[token]/page.tsx`

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { getAppointmentByToken, cancelViaToken, ManageError } from "@/lib/manage";

export default async function ManagePage({
  params, searchParams,
}: {
  params: Promise<{ token: string; locale: string }>;
  searchParams: Promise<{ booked?: string; updated?: string; cancelled?: string; error?: string }>;
}) {
  const { token, locale } = await params;
  const flags = await searchParams;
  const t = await getTranslations("Manage");
  const format = await getFormatter();
  const found = await getAppointmentByToken(token);
  if (!found) notFound();
  const a = found.appointment;
  const serviceName = locale === "en" ? a.service.nameEn : a.service.nameSq;

  async function cancelAction() {
    "use server";
    try {
      await cancelViaToken(token);
    } catch (e) {
      redirect(`/manage/${token}?error=${e instanceof ManageError ? e.code : "UNKNOWN"}`);
    }
    redirect(`/manage/${token}?cancelled=1`);
  }

  const banner =
    flags.booked ? t("bannerBooked")
    : flags.updated ? t("bannerUpdated")
    : flags.cancelled ? t("bannerCancelled")
    : null;

  return (
    <main className="mx-auto w-full max-w-md p-8">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      {banner && (
        <p className="mb-4 rounded bg-green-50 p-3 text-sm text-green-800">{banner}</p>
      )}
      {flags.error && (
        <p className="mb-4 text-sm text-red-600">{t(`errors.${flags.error}` as never)}</p>
      )}
      <div className="mb-6 rounded border p-4">
        <p className="font-semibold">{a.clinic.name}</p>
        <p className="text-sm text-gray-600">{a.clinic.city} · {a.clinic.address}</p>
        <p className="mt-3">{serviceName} · {a.membership.user?.name}</p>
        <p className="font-mono">
          {format.dateTime(a.startsAt, {
            dateStyle: "full", timeStyle: "short", timeZone: a.clinic.timezone })}
        </p>
        <p className="mt-2">
          <span className="rounded bg-gray-100 px-2 py-1 text-sm">
            {t(`status.${a.status}` as never)}
          </span>
        </p>
      </div>
      {found.cancellable ? (
        <div className="flex gap-3">
          <form action={cancelAction}>
            <button className="rounded border border-red-600 px-4 py-2 text-red-600">
              {t("cancel")}
            </button>
          </form>
          <Link
            href={`/clinics/${a.clinic.slug}/book?reschedule=${token}&serviceId=${a.serviceId}&membershipId=${a.membershipId}`}
            className="rounded bg-sky-600 px-4 py-2 text-white">
            {t("reschedule")}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-500">{t("notChangeable")}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: strings** — `sq.json`:

```json
  "Manage": {
    "title": "Termini juaj",
    "bannerBooked": "Termini u rezervua me sukses!",
    "bannerUpdated": "Termini u zhvendos me sukses!",
    "bannerCancelled": "Termini u anulua.",
    "cancel": "Anulo terminin",
    "reschedule": "Zhvendos terminin",
    "notChangeable": "Ky termin nuk mund të ndryshohet më përmes këtij linku.",
    "status": {
      "PENDING": "Në pritje të aprovimit",
      "CONFIRMED": "I konfirmuar",
      "DECLINED": "I refuzuar",
      "CANCELLED": "I anuluar",
      "COMPLETED": "I përfunduar",
      "NO_SHOW": "Nuk u paraqit"
    },
    "errors": {
      "WINDOW_PASSED": "Afati i anulimit ka kaluar",
      "NOT_ACTIVE": "Termini nuk është më aktiv",
      "NOT_FOUND": "Termini nuk u gjet",
      "SLOT_TAKEN": "Orari i ri sapo u zu",
      "UNKNOWN": "Gabim i papritur"
    }
  },
```

`en.json`:

```json
  "Manage": {
    "title": "Your appointment",
    "bannerBooked": "Appointment booked!",
    "bannerUpdated": "Appointment rescheduled!",
    "bannerCancelled": "Appointment cancelled.",
    "cancel": "Cancel appointment",
    "reschedule": "Reschedule",
    "notChangeable": "This appointment can no longer be changed via this link.",
    "status": {
      "PENDING": "Awaiting approval",
      "CONFIRMED": "Confirmed",
      "DECLINED": "Declined",
      "CANCELLED": "Cancelled",
      "COMPLETED": "Completed",
      "NO_SHOW": "No-show"
    },
    "errors": {
      "WINDOW_PASSED": "The cancellation window has passed",
      "NOT_ACTIVE": "The appointment is no longer active",
      "NOT_FOUND": "Appointment not found",
      "SLOT_TAKEN": "The new slot was just taken",
      "UNKNOWN": "Unexpected error"
    }
  },
```

- [ ] **Step 3: build** — `npm run build` clean.
- [ ] **Step 4: full booking smoke** — `npm run dev`, then walk: `/clinics` → Klinika Dentare Arta → Book a service → any dentist → next Friday → pick a slot → name + phone `+38344123456` → the OTP code appears in the dev-server console (`[SMS → …]`) → enter code → land on `/manage/<token>?booked=1` with a confirmation SMS in the console → cancel from the manage page → `cancelled=1` banner + cancellation SMS in console. Verify a `notifications` row per SMS: `npx prisma studio` or psql `SELECT template, status FROM notifications;`.
- [ ] **Step 5: commit** `feat: manage page for login-free cancel and reschedule`

---

### Task 9: Approval queue + staff cancel

**Files:**
- Create: `src/app/[locale]/dashboard/requests/page.tsx`
- Modify: `src/app/[locale]/dashboard/layout.tsx` (nav), `src/app/[locale]/dashboard/page.tsx` (cancel button), both message files

**Interfaces:**
- Consumes: `acceptAppointment`, `declineAppointment`, `cancelAppointmentByStaff`, `expireStalePending` (Task 5), `requireStaff` (Phase 2).

- [ ] **Step 1: requests page** — `src/app/[locale]/dashboard/requests/page.tsx`

```tsx
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
```

- [ ] **Step 2: nav item** — in `src/app/[locale]/dashboard/layout.tsx` replace the `nav` array with:

```tsx
  const nav = [
    ["", t("nav.appointments")], ["requests", t("nav.requests")],
    ["services", t("nav.services")], ["staff", t("nav.staff")],
    ["schedules", t("nav.schedules")], ["settings", t("nav.settings")],
  ] as const;
```

- [ ] **Step 3: staff cancel on today's list** — in `src/app/[locale]/dashboard/page.tsx`, add the imports:

```tsx
import { revalidatePath } from "next/cache";
import { cancelAppointmentByStaff } from "@/lib/appointment-actions";
```

add the action inside the component (after the `appts` query):

```tsx
  async function cancelAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await cancelAppointmentByStaff(c, String(formData.get("id")));
    revalidatePath("/dashboard");
  }
```

and replace the `<li>` body so active appointments get a cancel button:

```tsx
          <li key={a.id}
              className="flex items-center justify-between rounded border p-3">
            <span>
              <span className="font-mono">
                {format.dateTime(a.startsAt, { hour: "2-digit", minute: "2-digit" })}
              </span>
              {" — "}{a.patient.name} · {a.service.nameSq} · {a.membership.user.name}
              <span className="ml-2 rounded bg-gray-100 px-2 text-sm">{a.status}</span>
            </span>
            {(a.status === "PENDING" || a.status === "CONFIRMED") && (
              <form action={cancelAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
                  {t("cancel")}
                </button>
              </form>
            )}
          </li>
```

- [ ] **Step 4: strings** — inside the `Dashboard` namespace of `sq.json`: add `"requests"` to `nav` (`"requests": "Kërkesat"`), add `"cancel": "Anulo"` at the `Dashboard` top level (next to `todayTitle`), and add the block:

```json
    "requests": {
      "title": "Kërkesat në pritje",
      "empty": "Nuk ka kërkesa në pritje",
      "accept": "Prano",
      "decline": "Refuzo"
    },
```

`en.json`: `"requests": "Requests"` in `nav`, `"cancel": "Cancel"` at `Dashboard` top level, and:

```json
    "requests": {
      "title": "Pending requests",
      "empty": "No pending requests",
      "accept": "Accept",
      "decline": "Decline"
    },
```

- [ ] **Step 5: verify** — `npm run build` clean. Smoke: set Klinika Arta to `APPROVAL` in `/dashboard/settings`, book a slot as a patient (console OTP) → SMS says request sent; `/dashboard/requests` as `arta@klinika-arta.dev` shows it; Accept → confirmation SMS in console; patient's `/manage/<token>` shows "Confirmed". Set the clinic back to `INSTANT`.
- [ ] **Step 6: commit** `feat: approval request queue and staff cancellation`

---

### Task 10: Twilio SMS provider + final verification

**Files:**
- Create: `src/lib/sms/twilio.ts`
- Modify: `src/lib/sms/index.ts`
- Test: `tests/sms-twilio.test.ts`

**Interfaces:**
- Produces: `TwilioSmsProvider implements SmsProvider`; constructor `(sid?, token?, from?, fetchFn?)` defaulting to `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` env vars and global `fetch`. `getSmsProvider()` returns it when `SMS_PROVIDER=twilio`.

- [ ] **Step 1: write the failing test** — `tests/sms-twilio.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { TwilioSmsProvider } from "@/lib/sms/twilio";

describe("TwilioSmsProvider", () => {
  it("POSTs the message to the Twilio API and returns the sid", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 });
    }) as typeof fetch;
    const p = new TwilioSmsProvider("AC1", "tok", "+15550001111", fakeFetch);
    const r = await p.send("+38344123456", "Test");
    expect(r.providerRef).toBe("SM123");
    expect(calls[0].url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const body = String(calls[0].init.body);
    expect(body).toContain("To=%2B38344123456");
    expect(body).toContain("Body=Test");
    expect(String((calls[0].init.headers as Record<string, string>).Authorization))
      .toContain("Basic ");
  });
  it("throws on non-2xx responses", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const p = new TwilioSmsProvider("AC1", "tok", "+15550001111", fakeFetch);
    await expect(p.send("+38344123456", "Test")).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: run, expect FAIL** → **Step 3: implement** — `src/lib/sms/twilio.ts`

```ts
import type { SmsProvider } from "./types";

/** Twilio REST API (supports +383). Selected via SMS_PROVIDER=twilio. */
export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private sid: string = process.env.TWILIO_ACCOUNT_SID ?? "",
    private token: string = process.env.TWILIO_AUTH_TOKEN ?? "",
    private from: string = process.env.TWILIO_FROM ?? "",
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(to: string, message: string) {
    const res = await this.fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " +
            Buffer.from(`${this.sid}:${this.token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: this.from, Body: message }),
      });
    if (!res.ok) {
      throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { sid: string };
    return { providerRef: data.sid };
  }
}
```

and in `src/lib/sms/index.ts` add the case (and import):

```ts
import type { SmsProvider } from "./types";
import { ConsoleSmsProvider } from "./console";
import { TwilioSmsProvider } from "./twilio";

export function getSmsProvider(): SmsProvider {
  switch (process.env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSmsProvider();
    case "console":
    default:
      return new ConsoleSmsProvider();
  }
}
export type { SmsProvider };
```

- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: FINAL — full suite + build + smoke**

```powershell
npm run test    # all suites green
npm run build   # clean
# npm run dev → full walk: marketplace → book (instant) → manage → cancel →
#               book (approval) → dashboard requests → accept → reschedule via manage-link
```

- [ ] **Step 6: commit** `feat: Twilio SMS provider` → merge via finishing-a-development-branch

---

## Phase 3 exit criteria

- Anonymous patient books end-to-end: marketplace → clinic → service → dentist/any → date → free slot → OTP → appointment `CONFIRMED` (instant) or `PENDING` (approval), SMS with manage link recorded in the notifications outbox
- Two concurrent bookings of one slot: exactly one wins (proven by test)
- Manage link works without login: view, cancel, reschedule — all inside the cancellation window; link dead after the appointment ends
- Approval clinics see pending requests in the dashboard, accept/decline notifies the patient by SMS, stale requests auto-decline
- Staff can cancel today's appointments from the dashboard
- All new strings in sq + en; full suite green; build clean
