import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { logActivity } from "./models/activity-log";

export class ReviewError extends Error {
  constructor(public code:
    "NOT_FOUND" | "NOT_COMPLETED" | "ALREADY_REVIEWED" | "INVALID_INPUT") {
    super(code);
  }
}

const schema = z.object({
  rating: z.coerce.number().int().min(1).max(5), // forms post it as a string
  comment: z.string().trim().max(1000).optional(),
});

function isUniqueViolation(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (code === "P2002" || code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const findByToken = (token: string) =>
  withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findUnique({
      where: { manageToken: token },
      include: { clinic: true, service: true, membership: { include: { user: true } } },
    }));

/** What the review page needs; null for an unknown link. */
export async function getReviewContext(token: string) {
  const appointment = await findByToken(token);
  if (!appointment) return null;
  // Read as the patient: a HIDDEN review is visible only to its author.
  const review = await withDbContext(
    { role: "patient", userId: appointment.patientUserId }, (tx) =>
      tx.review.findUnique({ where: { appointmentId: appointment.id } }));
  return { appointment, review };
}

/**
 * Spec §6: reviews are verified-only — one per COMPLETED appointment. The
 * manage token from the review invitation SMS is the capability.
 */
export async function submitReview(token: string, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ReviewError("INVALID_INPUT");
  const ctx = await getReviewContext(token);
  if (!ctx) throw new ReviewError("NOT_FOUND");
  const { appointment: appt } = ctx;
  if (appt.status !== "COMPLETED") throw new ReviewError("NOT_COMPLETED");
  if (ctx.review) throw new ReviewError("ALREADY_REVIEWED");

  let review;
  try {
    review = await withDbContext({ role: "patient", userId: appt.patientUserId }, (tx) =>
      tx.review.create({
        data: { clinicId: appt.clinicId, patientUserId: appt.patientUserId,
                appointmentId: appt.id, rating: parsed.data.rating,
                comment: parsed.data.comment || null } }));
  } catch (e) {
    // two tabs submitting at once: the unique appointment_id settles it
    if (isUniqueViolation(e)) throw new ReviewError("ALREADY_REVIEWED");
    throw e;
  }
  try {
    await logActivity("review_submitted",
      `New ${review.rating}★ review for ${appt.clinic.name}`, { reviewId: review.id });
  } catch (e) {
    console.error("logActivity(review_submitted) failed", e);
  }
  return review;
}

export async function listReviewsForModeration(ctx: { userId: string }) {
  return withDbContext({ role: "admin", userId: ctx.userId }, (tx) =>
    tx.review.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      include: { clinic: { select: { name: true, slug: true } } } }));
}

export async function setReviewStatus(
  ctx: { userId: string }, reviewId: string, status: "PUBLISHED" | "HIDDEN",
) {
  await withDbContext({ role: "admin", userId: ctx.userId }, (tx) =>
    tx.review.update({ where: { id: reviewId }, data: { status } }));
}
