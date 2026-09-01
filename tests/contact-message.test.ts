import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { ContactMessage } from "@/lib/models/contact-message";

describe("ContactMessage", () => {
  afterAll(async () => {
    await connectMongo();
    await ContactMessage.deleteMany({});
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("saves a contact message", async () => {
    await connectMongo();
    const msg = await ContactMessage.create({
      name: "Arta",
      email: "arta@example.com",
      message: "Hello, I have a question.",
    });
    expect(msg.name).toBe("Arta");
    expect(msg.email).toBe("arta@example.com");
    expect(msg.message).toBe("Hello, I have a question.");
  });

  it("rejects a message missing a required field", async () => {
    await connectMongo();
    await expect(
      ContactMessage.create({ name: "Arta", message: "Hello" }),
    ).rejects.toThrow();
  });
});
