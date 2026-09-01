import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { ActivityLog, logActivity } from "@/lib/models/activity-log";

describe("logActivity", () => {
  afterAll(async () => {
    await connectMongo();
    await ActivityLog.deleteMany({});
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("records an activity entry with metadata", async () => {
    await logActivity("booking_created", "Arta booked at Smile Clinic", {
      clinicId: "clinic-1",
      appointmentId: "appt-1",
    });
    const entries = await ActivityLog.find({ type: "booking_created" });
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("Arta booked at Smile Clinic");
    expect(entries[0].metadata).toEqual({
      clinicId: "clinic-1",
      appointmentId: "appt-1",
    });
  });

  it("records an activity entry without metadata", async () => {
    await logActivity("clinic_approved", "Smile Clinic was approved");
    const entries = await ActivityLog.find({ type: "clinic_approved" });
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toBeUndefined();
  });
});
