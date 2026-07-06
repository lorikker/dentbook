import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, app, asContext, truncateAll } from "./helpers/db";

let clinicA: string, clinicB: string;
let staffA: string, patientX: string;
let dentistMembershipA: string;
let dentistUserA: string, dentistUserB: string;

beforeAll(async () => {
  await truncateAll();
  const a = await direct.clinic.create({
    data: { slug: "klinika-a", name: "Klinika A", city: "Prishtinë",
            address: "Rr. A 1", phone: "+38344111111", published: true },
  });
  const b = await direct.clinic.create({
    data: { slug: "klinika-b", name: "Klinika B", city: "Prizren",
            address: "Rr. B 2", phone: "+38344222222", published: false },
  });
  clinicA = a.id; clinicB = b.id;

  const ua = await direct.user.create({
    data: { name: "Staff A", email: "staff@a.com", passwordHash: "x" },
  });
  staffA = ua.id;
  await direct.membership.create({
    data: { userId: staffA, clinicId: clinicA, role: "OWNER" },
  });

  // one dentist per clinic (separate users — user+clinic is unique)
  const drA = await direct.user.create({ data: { name: "Dr A", email: "dr@a.com" } });
  dentistUserA = drA.id;
  const mA = await direct.membership.create({
    data: { userId: drA.id, clinicId: clinicA, role: "DENTIST" },
  });
  dentistMembershipA = mA.id;
  const drB = await direct.user.create({ data: { name: "Dr B", email: "dr@b.com" } });
  dentistUserB = drB.id;
  const mB = await direct.membership.create({
    data: { userId: drB.id, clinicId: clinicB, role: "DENTIST" },
  });

  const svcA = await direct.service.create({
    data: { clinicId: clinicA, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 },
  });
  const svcB = await direct.service.create({
    data: { clinicId: clinicB, nameSq: "Kontroll", nameEn: "Check-up",
            durationMin: 30, priceEur: 20 },
  });

  const px = await direct.user.create({
    data: { name: "Pacienti X", phone: "+38344999999" },
  });
  patientX = px.id;

  // the same patient has one appointment in EACH clinic
  await direct.appointment.create({
    data: { clinicId: clinicA, membershipId: mA.id,
            patientUserId: patientX, serviceId: svcA.id,
            startsAt: new Date("2026-08-01T09:00:00Z"),
            endsAt: new Date("2026-08-01T09:30:00Z"), status: "CONFIRMED" },
  });
  await direct.appointment.create({
    data: { clinicId: clinicB, membershipId: mB.id,
            patientUserId: patientX, serviceId: svcB.id,
            startsAt: new Date("2026-08-02T10:00:00Z"),
            endsAt: new Date("2026-08-02T10:30:00Z"), status: "CONFIRMED" },
  });
});

afterAll(async () => {
  await app.$disconnect();
  await direct.$disconnect();
});

describe("RLS tenant isolation", () => {
  it("staff of clinic A cannot read clinic B (unpublished)", async () => {
    const rows = await asContext(
      { role: "staff", userId: staffA, clinicId: clinicA },
      (tx) => tx.clinic.findMany(),
    );
    expect(rows.map((c) => c.id)).toContain(clinicA);
    expect(rows.map((c) => c.id)).not.toContain(clinicB);
  });

  it("staff of clinic A cannot update clinic B", async () => {
    const res = await asContext(
      { role: "staff", userId: staffA, clinicId: clinicA },
      (tx) => tx.clinic.updateMany({
        where: { id: clinicB }, data: { name: "HACKED" } }),
    );
    expect(res.count).toBe(0);
    const b = await direct.clinic.findUnique({ where: { id: clinicB } });
    expect(b!.name).toBe("Klinika B");
  });

  it("staff of clinic A sees only their clinic's appointments (1 of 2)", async () => {
    const rows = await asContext(
      { role: "staff", userId: staffA, clinicId: clinicA },
      (tx) => tx.appointment.findMany(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].clinicId).toBe(clinicA);
  });

  it("anonymous (public) sees only published clinics", async () => {
    const rows = await asContext({ role: "public" }, (tx) => tx.clinic.findMany());
    expect(rows.map((c) => c.id)).toEqual([clinicA]);
  });

  it("public cannot read appointments at all", async () => {
    const rows = await asContext({ role: "public" }, (tx) => tx.appointment.findMany());
    expect(rows).toEqual([]);
  });

  it("patient sees own appointments across clinics; user visibility is self + published-clinic dentists only", async () => {
    const appts = await asContext(
      { role: "patient", userId: patientX },
      (tx) => tx.appointment.findMany(),
    );
    expect(appts.length).toBe(2);
    const users = await asContext(
      { role: "patient", userId: patientX },
      (tx) => tx.user.findMany(),
    );
    const ids = users.map((u) => u.id);
    // dentists of PUBLISHED clinics are public marketplace profiles
    expect(new Set(ids)).toEqual(new Set([patientX, dentistUserA]));
    expect(ids).not.toContain(staffA);        // non-dentist staff stay hidden
    expect(ids).not.toContain(dentistUserB);  // unpublished clinic stays hidden
  });

  it("admin sees everything", async () => {
    const rows = await asContext({ role: "admin" }, (tx) => tx.clinic.findMany());
    expect(rows.length).toBe(2);
  });

  it("double-booking the same dentist slot is rejected by the DB", async () => {
    const appt = await direct.appointment.findFirstOrThrow({
      where: { membershipId: dentistMembershipA },
    });
    await expect(
      direct.appointment.create({
        data: {
          clinicId: appt.clinicId, membershipId: dentistMembershipA,
          patientUserId: patientX, serviceId: appt.serviceId,
          startsAt: new Date("2026-08-01T09:15:00Z"), // overlaps 09:00–09:30
          endsAt: new Date("2026-08-01T09:45:00Z"), status: "CONFIRMED",
        },
      }),
    ).rejects.toThrow();
  });
});
