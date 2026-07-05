import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { requestOtp, verifyOtp, OtpError } from "@/lib/otp";
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
