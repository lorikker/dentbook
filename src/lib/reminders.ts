import { withDbContext } from "./tenant-db";
import { notifyAppointment } from "./notify";
import { getSmsProvider, type SmsProvider } from "./sms";

/** Spec §8: a reminder SMS 24 hours before the appointment. */
export const REMINDER_LEAD_HOURS = 24;

/**
 * One reminder per CONFIRMED appointment starting within the lead time. Each
 * is claimed (reminder_sent_at) before sending so overlapping runs can't
 * double-send; a failed send releases the claim for the next run.
 */
export async function sendDueReminders(
  now = new Date(), provider: SmsProvider = getSmsProvider(),
): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_LEAD_HOURS * 3600_000);
  const due = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findMany({
      where: { status: "CONFIRMED", reminderSentAt: null,
               startsAt: { gt: now, lte: horizon } },
      select: { id: true } }));

  let sent = 0;
  for (const { id } of due) {
    const claimed = await withDbContext({ role: "auth" }, (tx) =>
      tx.appointment.updateMany({
        where: { id, reminderSentAt: null }, data: { reminderSentAt: now } }));
    if (claimed.count === 0) continue; // another run got it
    const row = await notifyAppointment("booking_reminder", id, provider);
    if (row?.status === "FAILED") {
      await withDbContext({ role: "auth" }, (tx) =>
        tx.appointment.update({ where: { id }, data: { reminderSentAt: null } }));
    } else if (row) {
      sent++;
    } // no row: the patient has no phone — keep the claim, there's nothing to send
  }
  return sent;
}
