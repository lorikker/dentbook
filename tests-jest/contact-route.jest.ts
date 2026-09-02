/**
 * @jest-environment node
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { POST } from "@/app/api/contact/route";
import { ContactMessage } from "@/lib/models/contact-message";
import { ActivityLog } from "@/lib/models/activity-log";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /api/contact", () => {
  it("writes a ContactMessage to Mongo and logs the activity", async () => {
    const req = new Request("http://localhost/api/contact", {
      method: "POST",
      body: JSON.stringify({ name: "Jane", email: "jane@test.com", message: "Hello" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const saved = await ContactMessage.findOne({ email: "jane@test.com" });
    expect(saved?.name).toBe("Jane");
    expect(saved?.message).toBe("Hello");
    const logged = await ActivityLog.findOne({ type: "contact_message" });
    expect(logged).not.toBeNull();
  });

  it("rejects invalid input with 400 and writes nothing", async () => {
    const req = new Request("http://localhost/api/contact", {
      method: "POST",
      body: JSON.stringify({ name: "", email: "not-an-email", message: "" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const saved = await ContactMessage.findOne({ email: "not-an-email" });
    expect(saved).toBeNull();
  });
});
