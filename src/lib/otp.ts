import { createHash, randomInt } from "node:crypto";
import type { User } from "@/generated/prisma/client";
import { withDbContext } from "./tenant-db";
import { getSmsProvider, type SmsProvider } from "./sms";
import { sendSms } from "./notify";

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_PER_PHONE_15MIN = 3;
const MAX_PER_IP_HOUR = 10;
const MAX_VERIFY_ATTEMPTS = 5;
/** Well past the TTL and both rate-limit windows, so pruning never loosens them. */
const OTP_RETENTION_MS = 24 * 3600 * 1000;

export class OtpError extends Error {
  constructor(public code:
    | "RATE_LIMITED_PHONE" | "RATE_LIMITED_IP" | "SEND_FAILED"
    | "INVALID_CODE" | "EXPIRED" | "TOO_MANY_ATTEMPTS") {
    super(code);
  }
}

function hashCode(phone: string, code: string): string {
  return createHash("sha256")
    .update(`${phone}:${code}:${process.env.OTP_PEPPER}`)
    .digest("hex");
}

export async function requestOtp(
  phone: string, ip: string, provider: SmsProvider = getSmsProvider(),
): Promise<{ ok: true }> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await withDbContext({ role: "auth" }, async (tx) => {
    const since15 = new Date(Date.now() - 15 * 60 * 1000);
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000);
    // Sequential: both counts run on the transaction's single connection, so
    // Promise.all only queues them behind each other (and trips a pg
    // deprecation that becomes a removal in pg@9). Checking the phone limit
    // first also lets the common rejection path skip the second count.
    const byPhone = await tx.otpCode.count({
      where: { phone, createdAt: { gte: since15 } } });
    if (byPhone >= MAX_PER_PHONE_15MIN) throw new OtpError("RATE_LIMITED_PHONE");
    const byIp = await tx.otpCode.count({
      where: { requestIp: ip, createdAt: { gte: sinceHour } } });
    if (byIp >= MAX_PER_IP_HOUR) throw new OtpError("RATE_LIMITED_IP");
    await tx.otpCode.create({
      data: {
        phone,
        codeHash: hashCode(phone, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        requestIp: ip,
      },
    });
  });
  // Through the outbox like every other SMS; the code stays out of the
  // payload — only its hash is ever stored.
  const sent = await sendSms({
    clinicId: null, recipient: phone, template: "otp_code", payload: {},
    message: `Dentbook: kodi juaj është ${code}` }, provider);
  if (sent.status === "FAILED") throw new OtpError("SEND_FAILED");
  return { ok: true };
}

type VerifyResult =
  | { error: OtpError["code"]; incrementId?: string }
  | { user: User };

export async function verifyOtp(phone: string, code: string, name: string) {
  const result = await withDbContext<VerifyResult>({ role: "auth" }, async (tx) => {
    const otp = await tx.otpCode.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { error: "INVALID_CODE" };
    if (otp.attempts >= MAX_VERIFY_ATTEMPTS) return { error: "TOO_MANY_ATTEMPTS" };
    if (otp.expiresAt < new Date()) return { error: "EXPIRED" };
    if (otp.codeHash !== hashCode(phone, code)) {
      // throwing here would roll back the increment — return and increment
      // in a separate transaction instead
      return { error: "INVALID_CODE", incrementId: otp.id };
    }
    await tx.otpCode.update({
      where: { id: otp.id }, data: { consumedAt: new Date() },
    });
    const existing = await tx.user.findUnique({ where: { phone } });
    if (existing) return { user: existing };
    return { user: await tx.user.create({ data: { phone, name } }) };
  });

  if ("error" in result) {
    if (result.incrementId) {
      await withDbContext({ role: "auth" }, (tx) =>
        tx.otpCode.update({
          where: { id: result.incrementId },
          data: { attempts: { increment: 1 } },
        }),
      );
    }
    throw new OtpError(result.error);
  }
  return result.user;
}

/** Deletes OTP rows past retention; returns how many were removed. */
export async function pruneOtpCodes(now = new Date()): Promise<number> {
  const { count } = await withDbContext({ role: "auth" }, (tx) =>
    tx.otpCode.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - OTP_RETENTION_MS) } } }));
  return count;
}
