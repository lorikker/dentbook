import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { createService, updateService, deleteService, listServices, ServiceError } from "@/lib/services";

let staffCtx: { userId: string; clinicId: string };

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "svc-klinika", name: "Svc", city: "P", address: "x", phone: "x" },
  });
  const owner = await direct.user.create({
    data: { name: "O", email: "svc@x.com", passwordHash: "x" },
  });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" },
  });
  staffCtx = { userId: owner.id, clinicId: clinic.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("services", () => {
  it("creates a service in the staff clinic", async () => {
    const s = await createService(staffCtx, {
      nameSq: "Pastrim", nameEn: "Cleaning", durationMin: 30, priceEur: 25 });
    expect(s.clinicId).toBe(staffCtx.clinicId);
  });
  it("rejects invalid duration", async () => {
    await expect(createService(staffCtx, {
      nameSq: "X", nameEn: "X", durationMin: 3, priceEur: 10 }))
      .rejects.toThrow(ServiceError);
  });
  it("updates and deactivates", async () => {
    const s = await createService(staffCtx, {
      nameSq: "Mbushje", nameEn: "Filling", durationMin: 60, priceEur: 40 });
    const upd = await updateService(staffCtx, s.id, { priceEur: 45, active: false });
    expect(Number(upd.priceEur)).toBe(45);
    expect(upd.active).toBe(false);
  });
  it("cannot touch another clinic's service", async () => {
    const other = await direct.clinic.create({
      data: { slug: "svc-other", name: "O", city: "P", address: "x", phone: "x" } });
    const foreign = await direct.service.create({
      data: { clinicId: other.id, nameSq: "F", nameEn: "F", durationMin: 30, priceEur: 10 } });
    await expect(updateService(staffCtx, foreign.id, { priceEur: 1 }))
      .rejects.toThrow();
  });
  it("deletes a service the staff owns", async () => {
    const s = await createService(staffCtx, {
      nameSq: "Heqje", nameEn: "Extraction", durationMin: 45, priceEur: 60 });
    await deleteService(staffCtx, s.id);
    const remaining = await listServices(staffCtx);
    expect(remaining.find((x) => x.id === s.id)).toBeUndefined();
  });
  it("cannot delete another clinic's service", async () => {
    const other = await direct.clinic.create({
      data: { slug: "svc-other-2", name: "O2", city: "P", address: "x", phone: "x" } });
    const foreign = await direct.service.create({
      data: { clinicId: other.id, nameSq: "F2", nameEn: "F2", durationMin: 30, priceEur: 10 } });
    await expect(deleteService(staffCtx, foreign.id)).rejects.toThrow(ServiceError);
  });
});
