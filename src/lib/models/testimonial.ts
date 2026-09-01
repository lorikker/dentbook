import { Schema, model, models, type InferSchemaType } from "mongoose";

const testimonialSchema = new Schema(
  {
    authorName: { type: String, required: true, trim: true },
    quote: { type: String, required: true, trim: true },
    role: { type: String, required: false, trim: true },
    photoUrl: { type: String, required: false, trim: true },
    published: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export type TestimonialDoc = InferSchemaType<typeof testimonialSchema>;

export const Testimonial =
  models.Testimonial ?? model("Testimonial", testimonialSchema);
