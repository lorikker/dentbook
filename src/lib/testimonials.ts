import { z } from "zod";
import { connectMongo } from "./mongo";
import { Testimonial } from "./models/testimonial";
import { logActivity } from "./models/activity-log";

export class TestimonialError extends Error {
  constructor(public code: "INVALID_INPUT") { super(code); }
}

const schema = z.object({
  authorName: z.string().trim().min(2).max(80),
  quote: z.string().trim().min(10).max(500),
  role: z.string().trim().max(80).optional(),
});

/** Public submission; stays unpublished until an admin publishes it. */
export async function submitTestimonial(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new TestimonialError("INVALID_INPUT");
  await connectMongo();
  const doc = await Testimonial.create({
    authorName: parsed.data.authorName, quote: parsed.data.quote,
    role: parsed.data.role || undefined, published: false });
  try {
    await logActivity("testimonial_submitted",
      `New testimonial from ${doc.authorName}`, { testimonialId: doc._id.toString() });
  } catch (e) {
    console.error("logActivity(testimonial_submitted) failed", e);
  }
  return { id: doc._id.toString() };
}

export async function listPublishedTestimonials(limit = 6) {
  await connectMongo();
  const docs = await Testimonial.find({ published: true })
    .sort({ createdAt: -1 }).limit(limit)
    .lean<{ _id: unknown; authorName: string; quote: string; role?: string }[]>();
  return docs.map((d) => ({
    id: String(d._id), authorName: d.authorName, quote: d.quote, role: d.role ?? null }));
}
