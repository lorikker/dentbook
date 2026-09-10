import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { listDirectoryClinics } from "@/lib/clinic-directory";

/**
 * These pin the filter semantics that moved out of the page component and
 * into SQL. The old code loaded every published clinic with every published
 * review and narrowed the set in JavaScript; the behaviour below is what that
 * JavaScript did, now asserted against the Postgres implementation.
 */

async function makeClinic(opts: {
  slug: string; name: string; city: string; published?: boolean;
  prices?: number[]; ratings?: number[]; hiddenRatings?: number[];
}) {
  const clinic = await direct.clinic.create({
    data: {
      slug: opts.slug, name: opts.name, city: opts.city,
      address: "Rr. 1", phone: "+38344000000",
      published: opts.published ?? true,
    },
  });
  for (const [i, p] of (opts.prices ?? []).entries()) {
    await direct.service.create({
      data: {
        clinicId: clinic.id, nameSq: `Sherbim ${i}`, nameEn: `Service ${i}`,
        durationMin: 30, priceEur: p, active: true,
      },
    });
  }
  const seedReview = async (rating: number, status: "PUBLISHED" | "HIDDEN") => {
    const patient = await direct.user.create({
      data: { name: "P", email: `rev-${clinic.slug}-${rating}-${status}-${Math.random()}@x.com` },
    });
    const service = await direct.service.create({
      data: {
        clinicId: clinic.id, nameSq: "x", nameEn: "x",
        durationMin: 30, priceEur: 999, active: false,
      },
    });
    const membershipUser = await direct.user.create({
      data: { name: "D", email: `den-${clinic.slug}-${rating}-${status}-${Math.random()}@x.com` },
    });
    const membership = await direct.membership.create({
      data: { userId: membershipUser.id, clinicId: clinic.id, role: "DENTIST" },
    });
    const appt = await direct.appointment.create({
      data: {
        clinicId: clinic.id, membershipId: membership.id,
        patientUserId: patient.id, serviceId: service.id,
        startsAt: new Date("2027-01-15T10:00:00Z"),
        endsAt: new Date("2027-01-15T10:30:00Z"),
        status: "COMPLETED",
      },
    });
    await direct.review.create({
      data: {
        clinicId: clinic.id, patientUserId: patient.id,
        appointmentId: appt.id, rating, status,
      },
    });
  };
  for (const r of opts.ratings ?? []) await seedReview(r, "PUBLISHED");
  for (const r of opts.hiddenRatings ?? []) await seedReview(r, "HIDDEN");
  return clinic;
}

beforeAll(async () => {
  await truncateAll();
  // cheapest 20, rated 4 and 2 (avg 3)
  await makeClinic({ slug: "dir-alfa", name: "Alfa Dental", city: "Prishtinë", prices: [35, 20], ratings: [4, 2] });
  // cheapest 45, rated 5
  await makeClinic({ slug: "dir-beta", name: "Beta Klinika", city: "Prizren", prices: [45], ratings: [5] });
  // no active services at all -> no price
  await makeClinic({ slug: "dir-gama", name: "Gama Care", city: "Prishtinë" });
  // unpublished: must never appear, and its city must not reach the chips
  await makeClinic({ slug: "dir-delta", name: "Delta Hidden", city: "Gjakovë", published: false, prices: [10] });
});
afterAll(async () => { await direct.$disconnect(); });

const slugs = (r: { clinics: { slug: string }[] }) => r.clinics.map((c) => c.slug);

describe("listDirectoryClinics", () => {
  it("returns only published clinics", async () => {
    const r = await listDirectoryClinics({});
    expect(slugs(r)).toEqual(["dir-alfa", "dir-beta", "dir-gama"]);
  });

  it("lists cities from published clinics only, sorted", async () => {
    const r = await listDirectoryClinics({});
    expect(r.cities).toEqual(["Prishtinë", "Prizren"]);
  });

  it("keeps the full city list even while filtered, so the chips stay stable", async () => {
    const r = await listDirectoryClinics({ city: "Prizren" });
    expect(slugs(r)).toEqual(["dir-beta"]);
    expect(r.cities).toEqual(["Prishtinë", "Prizren"]);
  });

  it("matches names case-insensitively on a substring", async () => {
    expect(slugs(await listDirectoryClinics({ q: "alfa" }))).toEqual(["dir-alfa"]);
    expect(slugs(await listDirectoryClinics({ q: "KLIN" }))).toEqual(["dir-beta"]);
    expect(slugs(await listDirectoryClinics({ q: "  Care  " }))).toEqual(["dir-gama"]);
  });

  it("reports the cheapest active service as the price", async () => {
    const r = await listDirectoryClinics({});
    const byslug = Object.fromEntries(r.clinics.map((c) => [c.slug, c]));
    expect(byslug["dir-alfa"].price).toBe(20);
    expect(byslug["dir-beta"].price).toBe(45);
    expect(byslug["dir-gama"].price).toBeNull();
  });

  it("filters on the cheapest service and keeps priceless clinics visible", async () => {
    // Alfa's cheapest is 20 so it passes; Beta's 45 does not; Gama has no
    // price at all and is retained, matching the previous JS behaviour.
    expect(slugs(await listDirectoryClinics({ maxPrice: 30 }))).toEqual(["dir-alfa", "dir-gama"]);
  });

  it("ignores an unparseable price bound instead of matching nothing", async () => {
    expect(slugs(await listDirectoryClinics({ maxPrice: Number("abc") })))
      .toEqual(["dir-alfa", "dir-beta", "dir-gama"]);
  });

  it("averages published reviews and ignores hidden ones", async () => {
    await makeClinic({ slug: "dir-eps", name: "Epsilon", city: "Pejë", ratings: [5, 3], hiddenRatings: [1] });
    const r = await listDirectoryClinics({ q: "Epsilon" });
    expect(r.clinics[0].avgRating).toBe(4);
    expect(r.clinics[0].reviewCount).toBe(2);
  });

  it("reports no rating for a clinic without published reviews", async () => {
    const r = await listDirectoryClinics({ q: "Gama" });
    expect(r.clinics[0].avgRating).toBeNull();
    expect(r.clinics[0].reviewCount).toBe(0);
  });

  it("sorts by name, rating and price", async () => {
    expect(slugs(await listDirectoryClinics({ city: "Prishtinë", sort: "name" })))
      .toEqual(["dir-alfa", "dir-gama"]);
    // Beta (5) outranks Alfa (3); unrated clinics sort last.
    const byRating = await listDirectoryClinics({ sort: "rating" });
    expect(byRating.clinics[0].slug).toBe("dir-beta");
    expect(byRating.clinics.at(-1)!.avgRating).toBeNull();
    // Priceless clinics sort last on price.
    const byPrice = await listDirectoryClinics({ sort: "price" });
    expect(byPrice.clinics[0].slug).toBe("dir-alfa");
    expect(byPrice.clinics.at(-1)!.price).toBeNull();
  });
});
