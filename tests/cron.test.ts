import { describe, it, expect, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { runScheduledJobs } from "@/lib/cron";

const NOW = new Date("2027-05-03T08:00:00Z");
const H = 3600_000;

afterAll(async () => { await direct.$disconnect(); });

describe("runScheduledJobs", () => {
  it("keeps running the remaining jobs when one fails, and reports each", async () => {
    const ran: string[] = [];
    const summary = await runScheduledJobs(new Date("2027-01-01T00:00:00Z"), {
      first: async () => { throw new Error("boom"); },
      second: async (now) => { ran.push(now.toISOString()); return 7; },
    });
    expect(ran).toEqual(["2027-01-01T00:00:00.000Z"]);
    expect(summary).toEqual({
      first: { ok: false, error: "boom" },
      second: { ok: true, result: 7 },
    });
  });

  it("the default schedule runs every housekeeping job against the database", async () => {
    await truncateAll();
    const clinic = await direct.clinic.create({
      data: { slug: "cr-klinika", name: "Cr", city: "P", address: "x", phone: "x",
              published: true } });
    await direct.subscription.create({
      data: { clinicId: clinic.id, plan: "TRIAL",
              trialEndsAt: new Date(NOW.getTime() - 24 * H) } });
    const service = await direct.service.create({
      data: { clinicId: clinic.id, nameSq: "P", nameEn: "C", durationMin: 30, priceEur: 20 } });
    const du = await direct.user.create({
      data: { name: "Dr", email: "cr-dr@x.com", passwordHash: "x" } });
    const dr = await direct.membership.create({
      data: { userId: du.id, clinicId: clinic.id, role: "DENTIST" } });
    const patient = await direct.user.create({ data: { name: "P", phone: "+38344630001" } });
    const at = (offsetH: number, status: "CONFIRMED" | "PENDING" | "AWAITING_PAYMENT",
                createdAt?: Date) =>
      direct.appointment.create({ data: {
        clinicId: clinic.id, membershipId: dr.id, patientUserId: patient.id,
        serviceId: service.id, status,
        startsAt: new Date(NOW.getTime() + offsetH * H),
        endsAt: new Date(NOW.getTime() + offsetH * H + 30 * 60_000),
        ...(createdAt ? { createdAt } : {}) } });
    await at(2, "CONFIRMED");                                      // due a reminder
    const staleRequest = await at(-2, "PENDING");                 // never answered
    const abandonedHold = await at(5, "AWAITING_PAYMENT",
                                   new Date(NOW.getTime() - 20 * 60_000));
    await direct.otpCode.create({ data: {
      phone: "+38344630001", codeHash: "x", expiresAt: NOW,
      createdAt: new Date(NOW.getTime() - 25 * H) } });

    const summary = await runScheduledJobs(NOW);

    expect(Object.entries(summary).filter(([, r]) => !r.ok)).toEqual([]);
    expect(await direct.notification.count({ where: { template: "booking_reminder" } })).toBe(1);
    expect((await direct.appointment.findUniqueOrThrow({
      where: { id: staleRequest.id } })).status).toBe("DECLINED");
    expect((await direct.appointment.findUniqueOrThrow({
      where: { id: abandonedHold.id } })).status).toBe("CANCELLED");
    expect(await direct.invoice.count()).toBe(1);
    expect(await direct.otpCode.count()).toBe(0);
  });
});
