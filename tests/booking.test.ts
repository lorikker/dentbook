import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { createBooking, BookingError } from "@/lib/booking";

// Friday 2027-01-15; Europe/Belgrade is UTC+1 in January.
const SLOT_10_WALL = "2027-01-15T09:00:00.000Z";

const instantSlug = "bk-instant", approvalSlug = "bk-approval";
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
