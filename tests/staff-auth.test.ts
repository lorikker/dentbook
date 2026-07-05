import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { hashPassword, verifyStaffLogin } from "@/lib/staff-auth";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await direct.$disconnect();
});

describe("staff login", () => {
  it("returns the user for correct email+password", async () => {
    await direct.user.create({
      data: { name: "Owner", email: "owner@klinika.com",
              passwordHash: await hashPassword("sekret123") },
    });
    const user = await verifyStaffLogin("owner@klinika.com", "sekret123");
    expect(user?.email).toBe("owner@klinika.com");
  });

  it("returns null for wrong password", async () => {
    await direct.user.create({
      data: { name: "Owner", email: "owner@klinika.com",
              passwordHash: await hashPassword("sekret123") },
    });
    expect(await verifyStaffLogin("owner@klinika.com", "gabim")).toBeNull();
  });

  it("returns null for unknown email and for passwordless (patient) users", async () => {
    await direct.user.create({
      data: { name: "Pacient", email: "p@x.com", phone: "+38344000001" },
    });
    expect(await verifyStaffLogin("nuk@ekziston.com", "x")).toBeNull();
    expect(await verifyStaffLogin("p@x.com", "x")).toBeNull();
  });
});
