import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { resolveStaffMembership } from "@/lib/staff-context";

let ownerId: string, patientId: string, clinicId: string;

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "ctx-klinika", name: "Ctx", city: "Prishtinë",
            address: "x", phone: "x" },
  });
  clinicId = clinic.id;
  const owner = await direct.user.create({
    data: { name: "Owner", email: "ctx-owner@x.com", passwordHash: "x" },
  });
  ownerId = owner.id;
  await direct.membership.create({
    data: { userId: ownerId, clinicId, role: "OWNER" },
  });
  const patient = await direct.user.create({
    data: { name: "P", phone: "+38344555000" },
  });
  patientId = patient.id;
});

afterAll(async () => { await direct.$disconnect(); });

describe("resolveStaffMembership", () => {
  it("returns clinic + role for staff", async () => {
    const ctx = await resolveStaffMembership(ownerId);
    expect(ctx).toEqual({ clinicId, role: "OWNER", membershipId: expect.any(String) });
  });
  it("returns null for users with no membership", async () => {
    expect(await resolveStaffMembership(patientId)).toBeNull();
  });
});
