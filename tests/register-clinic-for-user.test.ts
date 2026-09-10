import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { registerClinicForUser } from "@/lib/register-clinic";

const clinic = { clinicName: "Klinika Ime", city: "Prishtinë", address: "Rr. 1", phone: "+38344123456" };

beforeAll(async () => { await truncateAll(); });
afterAll(async () => { await direct.$disconnect(); });

describe("registerClinicForUser", () => {
  it("puts the clinic on the signed-in account as its owner", async () => {
    const user = await direct.user.create({ data: { name: "Google Patient", email: "google-user@x.com" } });
    const r = await registerClinicForUser(user.id, clinic);

    const m = await direct.membership.findFirst({ where: { userId: user.id } });
    expect(m).toMatchObject({ clinicId: r.clinicId, role: "OWNER" });
    const c = await direct.clinic.findUnique({ where: { id: r.clinicId }, include: { subscription: true } });
    expect(c?.published).toBe(false);
    expect(c?.subscription?.plan).toBe("TRIAL");
    // No second account was created along the way.
    expect(await direct.user.count({ where: { email: "google-user@x.com" } })).toBe(1);
  });

  it("refuses a second clinic for the same account", async () => {
    const user = await direct.user.create({ data: { name: "Owner Two", email: "owner-two@x.com" } });
    await registerClinicForUser(user.id, clinic);
    await expect(registerClinicForUser(user.id, { ...clinic, clinicName: "Another One" }))
      .rejects.toMatchObject({ code: "ALREADY_HAS_CLINIC" });
  });

  it("validates clinic fields with the same codes as full registration", async () => {
    const user = await direct.user.create({ data: { name: "Owner Three", email: "owner-three@x.com" } });
    await expect(registerClinicForUser(user.id, { ...clinic, clinicName: "A" }))
      .rejects.toMatchObject({ code: "CLINIC_NAME_TOO_SHORT" });
  });
});
