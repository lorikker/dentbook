import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { updateClinicSettings, SettingsError } from "@/lib/clinic-settings";

let ctx: { userId: string; clinicId: string };

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "set-klinika", name: "Set", city: "P", address: "x", phone: "x" } });
  const owner = await direct.user.create({
    data: { name: "O", email: "set@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  ctx = { userId: owner.id, clinicId: clinic.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("updateClinicSettings", () => {
  it("updates booking mode and cancellation window", async () => {
    const c = await updateClinicSettings(ctx, {
      bookingMode: "APPROVAL", cancellationWindowHours: 48 });
    expect(c.bookingMode).toBe("APPROVAL");
    expect(c.cancellationWindowHours).toBe(48);
  });
  it("rejects nonsense window", async () => {
    await expect(updateClinicSettings(ctx, { cancellationWindowHours: -1 }))
      .rejects.toThrow(SettingsError);
  });
});
