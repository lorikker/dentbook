import { describe, it, expect, afterEach, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { Testimonial } from "@/lib/models/testimonial";
import { submitTestimonial, listPublishedTestimonials,
         TestimonialError } from "@/lib/testimonials";
import { rejectionOf } from "./helpers/rejection";

afterEach(async () => {
  await connectMongo();
  await Testimonial.deleteMany({});
});
afterAll(async () => { await (await connectMongo()).disconnect(); });

/** Raw insert so createdAt is exactly what the test says (bypasses timestamps). */
async function insert(authorName: string, published: boolean, createdAt: string) {
  await connectMongo();
  await Testimonial.collection.insertOne({
    authorName, quote: `${authorName} says booking was painless.`, published,
    createdAt: new Date(createdAt), updatedAt: new Date(createdAt) });
}

describe("submitTestimonial", () => {
  it("stores the submission unpublished, awaiting moderation", async () => {
    const { id } = await submitTestimonial({
      authorName: "  Blerta K.  ", quote: "Rezervova për dy minuta, pa telefonata.",
      role: "Patient" });
    const doc = await Testimonial.findById(id).lean<{ authorName: string;
      published: boolean; role: string }>();
    expect(doc).toMatchObject({ authorName: "Blerta K.", published: false, role: "Patient" });
  });

  it.each([
    { authorName: "", quote: "A perfectly long enough quote." },
    { authorName: "Dren", quote: "short" },
    { authorName: "Dren", quote: "x".repeat(501) },
  ])("rejects %j and stores nothing", async (input) => {
    const err = await rejectionOf(submitTestimonial(input));
    expect(err).toBeInstanceOf(TestimonialError);
    await connectMongo();
    expect(await Testimonial.countDocuments()).toBe(0);
  });
});

describe("listPublishedTestimonials", () => {
  it("lists only published testimonials, newest first", async () => {
    await insert("Old", true, "2027-01-01");
    await insert("Hidden", false, "2027-02-01");
    await insert("New", true, "2027-03-01");
    const list = await listPublishedTestimonials(10);
    expect(list.map((t) => t.authorName)).toEqual(["New", "Old"]);
  });

  it("returns at most `limit` testimonials", async () => {
    await insert("A", true, "2027-01-01");
    await insert("B", true, "2027-01-02");
    await insert("C", true, "2027-01-03");
    expect(await listPublishedTestimonials(2)).toHaveLength(2);
  });
});
