import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { listPendingClinics, approveClinic } from "@/lib/clinic-approvals";

let adminCtx: { userId: string };

beforeAll(async () => {
  await truncateAll();
  const admin = await direct.user.create({
    data: { name: "Admin", email: "admin@x.com", passwordHash: "x", isPlatformAdmin: true },
  });
  adminCtx = { userId: admin.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("clinic-approvals", () => {
  it("lists pending (unpublished) clinics and approves one", async () => {
    const clinic = await direct.clinic.create({
      data: { slug: "pending-klinika", name: "Pending Clinic", city: "Prishtina",
              address: "Rr. X", phone: "044000000", published: false },
    });

    const pending = await listPendingClinics(adminCtx);
    expect(pending.some((c) => c.id === clinic.id)).toBe(true);

    const approved = await approveClinic(adminCtx, clinic.id);
    expect(approved.published).toBe(true);
    expect(approved.approvedAt).not.toBeNull();

    const pendingAfter = await listPendingClinics(adminCtx);
    expect(pendingAfter.some((c) => c.id === clinic.id)).toBe(false);
  });
});
