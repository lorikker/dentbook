import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { Testimonial } from "@/lib/models/testimonial";

describe("Testimonial", () => {
  afterAll(async () => {
    await connectMongo();
    await Testimonial.deleteMany({});
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("defaults to unpublished", async () => {
    await connectMongo();
    const t = await Testimonial.create({
      authorName: "Blerta",
      quote: "Great clinic, very professional staff!",
    });
    expect(t.published).toBe(false);
  });

  it("can be published", async () => {
    await connectMongo();
    const t = await Testimonial.create({
      authorName: "Dren",
      quote: "Booking was fast and easy.",
    });
    t.published = true;
    await t.save();
    const reloaded = await Testimonial.findById(t._id);
    expect(reloaded?.published).toBe(true);
  });
});
