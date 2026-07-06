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
