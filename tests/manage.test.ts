import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { getAppointmentByToken, cancelViaToken, rescheduleViaToken,
         ManageError } from "@/lib/manage";

// Friday 2027-01-15, dentist works 09:00–17:00 wall (08:00–16:00Z in CET).
const NOW = new Date("2027-01-10T00:00:00Z"); // 5 days before → outside 24h window

const clinicSlug = "mg-klinika";
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
    await makeAppt("2027-01-15T14:00:00Z", "2027-01-15T14:30:00Z"); // blocker
    const a = await makeAppt("2027-01-15T15:00:00Z", "2027-01-15T15:30:00Z");
    await expect(rescheduleViaToken(a.manageToken, "2027-01-15T14:00:00.000Z", NOW))
      .rejects.toThrow(ManageError);
  });
});
