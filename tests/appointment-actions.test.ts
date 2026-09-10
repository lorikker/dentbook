import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { acceptAppointment, declineAppointment, cancelAppointmentByStaff,
         completeAppointment, markNoShow, expireStalePending,
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

const reviewInvitesFor = (appointmentId: string) =>
  direct.notification.findMany({ where: {
    template: "review_invite",
    payload: { path: ["appointmentId"], equals: appointmentId } } });

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

describe("completion", () => {
  it("invites the patient to review once the visit is completed", async () => {
    const a = await makeAppt("CONFIRMED", "2027-03-05T14:00:00Z");
    await completeAppointment(ctx, a.id);
    const invites = await reviewInvitesFor(a.id);
    expect(invites).toHaveLength(1);
    expect(invites[0].recipient).toBe("+38344900001");
  });
  it("sends no review invitation for a no-show", async () => {
    const a = await makeAppt("CONFIRMED", "2027-03-05T15:00:00Z");
    await markNoShow(ctx, a.id);
    expect(await reviewInvitesFor(a.id)).toHaveLength(0);
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
