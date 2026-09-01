import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";

describe("connectMongo", () => {
  afterAll(async () => {
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("connects to the test Mongo instance", async () => {
    const conn = await connectMongo();
    expect(conn.connection.readyState).toBe(1);
  });
});
