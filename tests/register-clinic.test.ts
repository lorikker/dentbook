import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { registerClinic, RegisterError } from "@/lib/register-clinic";

const INPUT = {
  ownerName: "Arta B", email: "arta@new.dev", password: "sekret123",
  clinicName: "Klinika e Re", city: "Gjakovë", address: "Rr. 1", phone: "+38344777000",
};

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await direct.$disconnect(); });

describe("registerClinic", () => {
  it("creates user, unpublished clinic, OWNER membership, TRIAL subscription", async () => {
    const { clinicId } = await registerClinic(INPUT);
    const clinic = await direct.clinic.findUniqueOrThrow({
      where: { id: clinicId }, include: { memberships: true, subscription: true },
    });
    expect(clinic.published).toBe(false);
    expect(clinic.slug).toBe("klinika-e-re");
    expect(clinic.memberships[0].role).toBe("OWNER");
    expect(clinic.subscription?.plan).toBe("TRIAL");
    const user = await direct.user.findUnique({ where: { email: INPUT.email } });
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toBe(INPUT.password);
  });

  it("suffixes the slug when taken", async () => {
    await registerClinic(INPUT);
    const second = await registerClinic({
      ...INPUT, email: "tjeter@new.dev", phone: "+38344777001" });
    const c2 = await direct.clinic.findUniqueOrThrow({ where: { id: second.clinicId } });
    expect(c2.slug).toBe("klinika-e-re-2");
  });

  it("rejects duplicate owner email", async () => {
    await registerClinic(INPUT);
    await expect(registerClinic(INPUT)).rejects.toThrow(RegisterError);
  });

  it("rejects a too-short password with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, password: "x" }))
      .rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT" });
  });

  it("rejects a malformed email with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, email: "not-an-email" }))
      .rejects.toMatchObject({ code: "INVALID_EMAIL" });
  });

  it("rejects a too-short owner name with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, ownerName: "A" }))
      .rejects.toMatchObject({ code: "NAME_TOO_SHORT" });
  });

  it("rejects a too-short clinic name with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, clinicName: "A" }))
      .rejects.toMatchObject({ code: "CLINIC_NAME_TOO_SHORT" });
  });

  it("rejects a too-short city with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, city: "A" }))
      .rejects.toMatchObject({ code: "CITY_TOO_SHORT" });
  });

  it("rejects a too-short address with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, address: "A" }))
      .rejects.toMatchObject({ code: "ADDRESS_TOO_SHORT" });
  });

  it("rejects a too-short phone with a specific code", async () => {
    await expect(registerClinic({ ...INPUT, phone: "123" }))
      .rejects.toMatchObject({ code: "PHONE_TOO_SHORT" });
  });
});
