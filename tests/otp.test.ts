import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { rejectionOf } from "./helpers/rejection";
import { requestOtp, verifyOtp, pruneOtpCodes, OtpError } from "@/lib/otp";
// (setup-env.ts already pointed DATABASE_URL at the test DB before imports)

const PHONE = "+38344123456";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await direct.$disconnect();
});

describe("requestOtp", () => {
  it("stores a hashed 6-digit code and returns nothing sensitive", async () => {
    const res = await requestOtp(PHONE, "1.2.3.4");
    expect(res).toEqual({ ok: true });
    const row = await direct.otpCode.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex, never plaintext
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a 4th request for the same phone within 15 minutes", async () => {
    await requestOtp(PHONE, "1.2.3.4");
    await requestOtp(PHONE, "1.2.3.4");
    await requestOtp(PHONE, "1.2.3.4");
    await expect(requestOtp(PHONE, "1.2.3.4")).rejects.toThrow(OtpError);
  });

  it("rejects an 11th request from the same IP within an hour", async () => {
    for (let i = 0; i < 10; i++) {
      await requestOtp(`+3834400000${i}`, "9.9.9.9");
    }
    await expect(requestOtp("+38344999998", "9.9.9.9")).rejects.toThrow(OtpError);
  });
});

describe("OTP delivery", () => {
  it("records every send in the notifications outbox, without the code", async () => {
    const code = await requestOtpReturningCode(PHONE);
    const rows = await direct.notification.findMany({ where: { template: "otp_code" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: PHONE, status: "SENT", channel: "SMS" });
    expect(JSON.stringify(rows[0].payload)).not.toContain(code);
  });

  it("surfaces a provider failure as SEND_FAILED and records it FAILED", async () => {
    const broken = { async send(): Promise<{ providerRef: string }> {
      throw new Error("down"); } };
    const err = await rejectionOf(requestOtp(PHONE, "1.2.3.4", broken));
    expect(err).toBeInstanceOf(OtpError);
    expect((err as OtpError).code).toBe("SEND_FAILED");
    const row = await direct.notification.findFirstOrThrow({ where: { template: "otp_code" } });
    expect(row.status).toBe("FAILED");
  });
});

describe("verifyOtp", () => {
  it("verifies the right code, creates the user, consumes the code", async () => {
    const code = await requestOtpReturningCode(PHONE);
    const user = await verifyOtp(PHONE, code, "Pacienti Test");
    expect(user.phone).toBe(PHONE);
    expect(user.name).toBe("Pacienti Test");
    // consumed: same code fails second time
    await expect(verifyOtp(PHONE, code, "X")).rejects.toThrow(OtpError);
  });

  it("re-verifying an existing phone returns the same user", async () => {
    const c1 = await requestOtpReturningCode(PHONE);
    const u1 = await verifyOtp(PHONE, c1, "Pacienti");
    const c2 = await requestOtpReturningCode(PHONE);
    const u2 = await verifyOtp(PHONE, c2, "Ignored");
    expect(u2.id).toBe(u1.id);
  });

  it("rejects a wrong code and blocks after 5 attempts", async () => {
    const code = await requestOtpReturningCode(PHONE);
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(PHONE, "000000", "X")).rejects.toThrow(OtpError);
    }
    // even the correct code is now rejected
    await expect(verifyOtp(PHONE, code, "X")).rejects.toThrow(OtpError);
  });

  it("rejects an expired code", async () => {
    const code = await requestOtpReturningCode(PHONE);
    await direct.otpCode.updateMany({
      where: { phone: PHONE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(verifyOtp(PHONE, code, "X")).rejects.toThrow(OtpError);
  });
});

describe("pruneOtpCodes", () => {
  it("deletes codes older than a day and keeps the rest", async () => {
    const now = new Date("2027-01-10T12:00:00Z");
    const H = 3600_000;
    await direct.otpCode.createMany({ data: [
      { phone: PHONE, codeHash: "old", expiresAt: now,
        createdAt: new Date(now.getTime() - 25 * H) },
      { phone: PHONE, codeHash: "recent", expiresAt: now,
        createdAt: new Date(now.getTime() - 23 * H) },
    ] });
    expect(await pruneOtpCodes(now)).toBe(1);
    expect((await direct.otpCode.findMany()).map((r) => r.codeHash)).toEqual(["recent"]);
  });
});

/** Requests an OTP and extracts the code from the console provider's stdout. */
async function requestOtpReturningCode(phone: string): Promise<string> {
  const spy = vi.spyOn(console, "log");
  await requestOtp(phone, "1.2.3.4");
  const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes(phone));
  spy.mockRestore();
  const m = line?.match(/\b(\d{6})\b/);
  if (!m) throw new Error("no OTP code logged");
  return m[1];
}
