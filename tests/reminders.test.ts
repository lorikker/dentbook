import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { sendDueReminders } from "@/lib/reminders";
import { rescheduleViaToken } from "@/lib/manage";
import type { AppointmentStatus } from "@/generated/prisma/client";
import type { SmsProvider } from "@/lib/sms";

const NOW = new Date("2027-02-01T08:00:00Z"); // Monday
const H = 3600_000;
const PHONE = "+38344620001";
let clinicId: string, serviceId: string, drId: string, patientId: string;

function recorder() {
  const sent: { to: string; message: string }[] = [];
  const provider: SmsProvider = {
    async send(to, message) {
      sent.push({ to, message });
      return { providerRef: `rec-${sent.length}` };
    },
  };
  return { sent, provider };
}
const broken: SmsProvider = { async send() { throw new Error("sms down"); } };

async function appt(status: AppointmentStatus, startsAt: Date) {
  return direct.appointment.create({
    data: { clinicId, membershipId: drId, patientUserId: patientId, serviceId,
            status, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000) } });
}

beforeEach(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "rm-klinika", name: "Rm", city: "P", address: "x", phone: "x",
            published: true, cancellationWindowHours: 24 } });
  clinicId = clinic.id;
  serviceId = (await direct.service.create({
    data: { clinicId, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 } })).id;
  const du = await direct.user.create({
    data: { name: "Dr", email: "rm-dr@x.com", passwordHash: "x" } });
  drId = (await direct.membership.create({
    data: { userId: du.id, clinicId, role: "DENTIST" } })).id;
  // Thursday 09:00–17:00 wall (UTC+1 in February), for the reschedule case
  await direct.schedule.create({
    data: { membershipId: drId, weekday: 4, startMin: 540, endMin: 1020 } });
  patientId = (await direct.user.create({ data: { name: "P", phone: PHONE } })).id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("sendDueReminders", () => {
  it("reminds only confirmed appointments starting within the next 24 hours", async () => {
    const due = await appt("CONFIRMED", new Date(NOW.getTime() + 23 * H));
    await appt("CONFIRMED", new Date(NOW.getTime() + 25 * H)); // too far out
    await appt("PENDING", new Date(NOW.getTime() + 2 * H));    // not confirmed
    await appt("CANCELLED", new Date(NOW.getTime() + 3 * H));  // cancelled
    await appt("CONFIRMED", new Date(NOW.getTime() - 1 * H));  // already started
    const { sent, provider } = recorder();

    expect(await sendDueReminders(NOW, provider)).toBe(1);

    expect(sent.map((s) => s.to)).toEqual([PHONE]);
    const rows = await direct.notification.findMany({ where: { template: "booking_reminder" } });
    expect(rows.map((r) => (r.payload as { appointmentId: string }).appointmentId))
      .toEqual([due.id]);
  });

  it("never reminds the same appointment twice", async () => {
    await appt("CONFIRMED", new Date(NOW.getTime() + 5 * H));
    const { sent, provider } = recorder();
    await sendDueReminders(NOW, provider);
    expect(await sendDueReminders(NOW, provider)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("retries on the next run when the SMS could not be sent", async () => {
    await appt("CONFIRMED", new Date(NOW.getTime() + 5 * H));
    expect(await sendDueReminders(NOW, broken)).toBe(0);
    const { sent, provider } = recorder();
    expect(await sendDueReminders(NOW, provider)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("a rescheduled appointment is reminded again for its new time", async () => {
    // Thursday 2027-02-04, three days out — outside the 24h change window.
    const a = await appt("CONFIRMED", new Date("2027-02-04T09:00:00Z"));
    await direct.appointment.update({ where: { id: a.id }, data: { reminderSentAt: NOW } });
    await rescheduleViaToken(a.manageToken, "2027-02-04T11:00:00.000Z", NOW);
    const moved = await direct.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(moved.startsAt.toISOString()).toBe("2027-02-04T11:00:00.000Z");
    expect(moved.reminderSentAt).toBeNull();
  });
});
