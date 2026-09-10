import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import {
  getAvailableSlots, getAvailableSlotsRange, AvailabilityError,
} from "@/lib/availability";

const NOW = new Date("2027-01-01T00:00:00Z");
const clinicSlug = "av-klinika";
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

describe("getAvailableSlotsRange", () => {
  it("aggregates slots per day across the window, applying each day's own exceptions/busy times", async () => {
    const slots = await getAvailableSlotsRange({
      clinicSlug, serviceId, fromDateISO: "2027-01-15", toDateISO: "2027-01-22", now: NOW });
    const jan15 = slots.filter((s) => s.startsAt.toISOString().startsWith("2027-01-15"));
    const jan22 = slots.filter((s) => s.startsAt.toISOString().startsWith("2027-01-22"));
    expect(jan15.length).toBeGreaterThan(0);
    expect(jan15.map((s) => s.startsAt.toISOString()))
      .not.toContain("2027-01-15T09:00:00.000Z"); // busy 10:00-11:00 wall
    expect(jan22).toEqual([]); // clinic-wide closure
  });
  it("only includes dentists linked to the service", async () => {
    const slots = await getAvailableSlotsRange({
      clinicSlug, serviceId, fromDateISO: "2027-01-15", toDateISO: "2027-01-15", now: NOW });
    expect(new Set(slots.map((s) => s.membershipId))).toEqual(new Set([drAId]));
  });
  it("filters to a specific dentist when membershipId is given", async () => {
    const slots = await getAvailableSlotsRange({
      clinicSlug, serviceId, membershipId: drBId,
      fromDateISO: "2027-01-15", toDateISO: "2027-01-22", now: NOW });
    expect(slots).toEqual([]); // Dr B is not linked to the service
  });
  it("rejects unpublished/unknown clinics", async () => {
    await expect(getAvailableSlotsRange({
      clinicSlug: "nuk-ka", serviceId,
      fromDateISO: "2027-01-15", toDateISO: "2027-01-22", now: NOW }))
      .rejects.toThrow(AvailabilityError);
  });
  it("rejects malformed dates", async () => {
    await expect(getAvailableSlotsRange({
      clinicSlug, serviceId, fromDateISO: "gabim", toDateISO: "2027-01-22", now: NOW }))
      .rejects.toThrow(AvailabilityError);
  });
});
