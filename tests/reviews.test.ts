import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll, asContext } from "./helpers/db";
import { rejectionOf } from "./helpers/rejection";
import { getReviewContext, submitReview, listReviewsForModeration,
         setReviewStatus, ReviewError } from "@/lib/reviews";
import type { AppointmentStatus } from "@/generated/prisma/client";

let clinicId: string, serviceId: string, drId: string;
let patientId: string, adminId: string;
let hour = 0;

/** Each call takes its own past hour, so appointments never overlap. */
async function appt(status: AppointmentStatus) {
  const startsAt = new Date(Date.UTC(2026, 0, 5) + hour++ * 3600_000);
  return direct.appointment.create({
    data: { clinicId, membershipId: drId, patientUserId: patientId, serviceId,
            status, startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000) } });
}

async function expectReviewError(p: Promise<unknown>, code: ReviewError["code"]) {
  const err = await rejectionOf(p);
  expect(err).toBeInstanceOf(ReviewError);
  expect((err as ReviewError).code).toBe(code);
}

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "rv-klinika", name: "Rv", city: "P", address: "x",
            phone: "x", published: true } });
  clinicId = clinic.id;
  serviceId = (await direct.service.create({
    data: { clinicId, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 } })).id;
  const du = await direct.user.create({
    data: { name: "Dr", email: "rv-dr@x.com", passwordHash: "x" } });
  drId = (await direct.membership.create({
    data: { userId: du.id, clinicId, role: "DENTIST" } })).id;
  patientId = (await direct.user.create({
    data: { name: "P", phone: "+38344640001" } })).id;
  adminId = (await direct.user.create({
    data: { name: "A", email: "rv-a@x.com", passwordHash: "x",
            isPlatformAdmin: true } })).id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("submitReview", () => {
  it("records a published review for a COMPLETED appointment", async () => {
    const a = await appt("COMPLETED");
    const r = await submitReview(a.manageToken, { rating: 4, comment: "  Shumë mirë  " });
    const row = await direct.review.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({
      rating: 4, comment: "Shumë mirë", status: "PUBLISHED",
      clinicId, patientUserId: patientId, appointmentId: a.id });
  });

  it("accepts the rating as the string a form posts", async () => {
    const a = await appt("COMPLETED");
    const r = await submitReview(a.manageToken, { rating: "5", comment: "" });
    expect(r.rating).toBe(5);
  });

  it("stores a blank comment as null", async () => {
    const a = await appt("COMPLETED");
    const r = await submitReview(a.manageToken, { rating: 3, comment: "   " });
    expect(r.comment).toBeNull();
  });

  it.each(["CONFIRMED", "PENDING", "CANCELLED", "NO_SHOW", "DECLINED"] as const)(
    "refuses a %s appointment — reviews are verified-only", async (status) => {
      const a = await appt(status);
      await expectReviewError(submitReview(a.manageToken, { rating: 5 }), "NOT_COMPLETED");
    });

  it("allows only one review per appointment", async () => {
    const a = await appt("COMPLETED");
    await submitReview(a.manageToken, { rating: 5 });
    await expectReviewError(submitReview(a.manageToken, { rating: 1 }), "ALREADY_REVIEWED");
  });

  it.each([0, 6, 3.5, "abc", undefined])("rejects rating %s", async (rating) => {
    const a = await appt("COMPLETED");
    await expectReviewError(submitReview(a.manageToken, { rating }), "INVALID_INPUT");
  });

  it("rejects a comment over 1000 characters", async () => {
    const a = await appt("COMPLETED");
    await expectReviewError(
      submitReview(a.manageToken, { rating: 4, comment: "x".repeat(1001) }), "INVALID_INPUT");
  });

  it("rejects an unknown token", async () => {
    await expectReviewError(
      submitReview("00000000-0000-0000-0000-000000000000", { rating: 4 }), "NOT_FOUND");
  });
});

describe("getReviewContext", () => {
  it("is null for an unknown token", async () => {
    expect(await getReviewContext("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("exposes an existing review so the page thanks instead of re-asking", async () => {
    const a = await appt("COMPLETED");
    expect((await getReviewContext(a.manageToken))?.review).toBeNull();
    await submitReview(a.manageToken, { rating: 4 });
    const ctx = await getReviewContext(a.manageToken);
    expect(ctx?.appointment.id).toBe(a.id);
    expect(ctx?.review?.rating).toBe(4);
  });
});

describe("moderation", () => {
  const publicView = (id: string) =>
    asContext({ role: "public" }, (tx) => tx.review.findMany({ where: { id } }));

  it("hiding a review removes it from public view but keeps it for admins", async () => {
    const a = await appt("COMPLETED");
    const r = await submitReview(a.manageToken, { rating: 1, comment: "spam" });
    expect(await publicView(r.id)).toHaveLength(1);

    await setReviewStatus({ userId: adminId }, r.id, "HIDDEN");

    expect(await publicView(r.id)).toHaveLength(0);
    const listed = (await listReviewsForModeration({ userId: adminId }))
      .find((x) => x.id === r.id);
    expect(listed?.status).toBe("HIDDEN");
    expect(listed?.clinic.name).toBe("Rv");
  });

  it("a hidden review can be published again", async () => {
    const a = await appt("COMPLETED");
    const r = await submitReview(a.manageToken, { rating: 2 });
    await setReviewStatus({ userId: adminId }, r.id, "HIDDEN");
    await setReviewStatus({ userId: adminId }, r.id, "PUBLISHED");
    expect(await publicView(r.id)).toHaveLength(1);
  });
});
