import { NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongo";
import { ContactMessage } from "@/lib/models/contact-message";
import { logActivity } from "@/lib/models/activity-log";

const schema = z.object({
  name: z.string().min(1),
  email: z.email(),
  message: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  await connectMongo();
  const doc = await ContactMessage.create(parsed.data);
  await logActivity("contact_message", `New message from ${parsed.data.name}`, { contactMessageId: doc._id.toString() });
  return NextResponse.json({ ok: true }, { status: 201 });
}
