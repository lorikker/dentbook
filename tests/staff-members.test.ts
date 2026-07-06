import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { addStaffMember, listStaff, StaffError } from "@/lib/staff-members";

let ownerCtx: { userId: string; clinicId: string; role: "OWNER" };
let receptionCtx: { userId: string; clinicId: string; role: "RECEPTIONIST" };

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "st-klinika", name: "St", city: "P", address: "x", phone: "x" } });
  const owner = await direct.user.create({
    data: { name: "O", email: "st-owner@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  const rec = await direct.user.create({
    data: { name: "R", email: "st-rec@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: rec.id, clinicId: clinic.id, role: "RECEPTIONIST" } });
  ownerCtx = { userId: owner.id, clinicId: clinic.id, role: "OWNER" };
  receptionCtx = { userId: rec.id, clinicId: clinic.id, role: "RECEPTIONIST" };
});
afterAll(async () => { await direct.$disconnect(); });

describe("addStaffMember", () => {
  it("owner adds a dentist with profile and temp password", async () => {
    const m = await addStaffMember(ownerCtx, {
      name: "Dr. Test", email: "dr-test@x.com", password: "fillestar1",
      role: "DENTIST", title: "Dr. med. dent." });
    expect(m.role).toBe("DENTIST");
    expect(m.title).toBe("Dr. med. dent.");
    const u = await direct.user.findUnique({ where: { email: "dr-test@x.com" } });
    expect(u?.passwordHash).toBeTruthy();
  });
  it("attaches an existing user by email instead of duplicating", async () => {
    const existing = await direct.user.create({
      data: { name: "E", email: "ex@x.com", passwordHash: "y" } });
    const m = await addStaffMember(ownerCtx, {
      name: "ignored", email: "ex@x.com", password: "ignored123",
      role: "RECEPTIONIST" });
    expect(m.userId).toBe(existing.id);
  });
  it("listStaff exposes colleague user rows under the staff RLS context", async () => {
    const staff = await listStaff(receptionCtx);
    expect(staff.length).toBeGreaterThanOrEqual(2);
    for (const m of staff) expect(m.user?.name).toBeTruthy();
  });
  it("non-owner cannot add staff", async () => {
    await expect(addStaffMember(receptionCtx, {
      name: "X", email: "no@x.com", password: "12345678", role: "DENTIST" }))
      .rejects.toThrow(StaffError);
  });
});
