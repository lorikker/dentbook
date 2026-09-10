import { expireUnpaidDeposits } from "./deposits";
import { expireStalePendingForAllClinics } from "./appointment-actions";
import { sendDueReminders } from "./reminders";
import { rolloverSubscriptions } from "./billing";
import { pruneOtpCodes } from "./otp";

export type Job = (now: Date) => Promise<unknown>;
export type JobResult = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * The housekeeping spec §4 gave a pg-boss worker. There is no long-running
 * process on Vercel, so one scheduled request (api/cron/tick) runs them all.
 */
export const scheduledJobs: Record<string, Job> = {
  expireUnpaidDeposits: (now) => expireUnpaidDeposits(now),
  expireStalePending: async (now) => (await expireStalePendingForAllClinics(now)).count,
  sendDueReminders: (now) => sendDueReminders(now),
  rolloverSubscriptions: (now) => rolloverSubscriptions(now),
  pruneOtpCodes: (now) => pruneOtpCodes(now),
};

/** Runs each job in turn; one failing never stops the rest. */
export async function runScheduledJobs(now = new Date(), jobs = scheduledJobs) {
  const summary: Record<string, JobResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    try {
      summary[name] = { ok: true, result: await job(now) };
    } catch (e) {
      summary[name] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return summary;
}
