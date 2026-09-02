import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import {
  addFavorite,
  removeFavorite,
  listFavoriteClinics,
  isFavorited,
  FavoriteError,
} from "@/lib/favorites";

let userA: { userId: string };
let userB: { userId: string };
let clinic1: { id: string };
let clinic2: { id: string };

beforeAll(async () => {
  await truncateAll();
  clinic1 = await direct.clinic.create({
    data: { slug: "fav-klinika-1", name: "Klinika 1", city: "P", address: "x", phone: "x", published: true },
  });
  clinic2 = await direct.clinic.create({
    data: { slug: "fav-klinika-2", name: "Klinika 2", city: "P", address: "x", phone: "x", published: true },
  });
  const a = await direct.user.create({
    data: { name: "A", email: "fav-a@x.com", passwordHash: "x" },
  });
  const b = await direct.user.create({
    data: { name: "B", email: "fav-b@x.com", passwordHash: "x" },
  });
  userA = { userId: a.id };
  userB = { userId: b.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("favorites", () => {
  it("creates a favorite scoped to the given user", async () => {
    const fav = await addFavorite(userA, clinic1.id);
    expect(fav.userId).toBe(userA.userId);
    expect(fav.clinicId).toBe(clinic1.id);
  });

  it("throws FavoriteError on duplicate favorite", async () => {
    await expect(addFavorite(userA, clinic1.id)).rejects.toThrow(FavoriteError);
  });

  it("lists only that user's favorited clinics, newest first", async () => {
    await addFavorite(userA, clinic2.id);
    const clinics = await listFavoriteClinics(userA);
    expect(clinics.map((c) => c.id)).toEqual([clinic2.id, clinic1.id]);
  });

  it("isFavorited reflects current state", async () => {
    expect(await isFavorited(userA, clinic1.id)).toBe(true);
    expect(await isFavorited(userA, clinic2.id)).toBe(true);
  });

  it("removes a favorite", async () => {
    await removeFavorite(userA, clinic2.id);
    const clinics = await listFavoriteClinics(userA);
    expect(clinics.map((c) => c.id)).toEqual([clinic1.id]);
    expect(await isFavorited(userA, clinic2.id)).toBe(false);
  });

  it("does not leak another user's favorites (RLS)", async () => {
    const clinics = await listFavoriteClinics(userB);
    expect(clinics).toEqual([]);
  });
});
