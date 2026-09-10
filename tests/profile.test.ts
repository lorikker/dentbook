import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { updateProfile, ProfileError } from "@/lib/profile";

let ctx: { userId: string };

beforeAll(async () => {
  await truncateAll();
  const user = await direct.user.create({
    data: { name: "Original Name", email: "profile@x.com", passwordHash: "x", locale: "sq" },
  });
  ctx = { userId: user.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("updateProfile", () => {
  it("updates name and locale", async () => {
    const u = await updateProfile(ctx, { name: "New Name", locale: "en" });
    expect(u.name).toBe("New Name");
    expect(u.locale).toBe("en");
  });
  it("rejects invalid input", async () => {
    await expect(updateProfile(ctx, { name: "", locale: "en" }))
      .rejects.toThrow(ProfileError);
  });
  it("never returns the password hash (the API route serialises this)", async () => {
    const u = await updateProfile(ctx, { name: "Still Fine", locale: "sq" });
    expect(u).not.toHaveProperty("passwordHash");
  });
});
