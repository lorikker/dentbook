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

  it("rejects invalid input (short password)", async () => {
    await expect(registerClinic({ ...INPUT, password: "x" }))
      .rejects.toThrow(RegisterError);
  });
});
