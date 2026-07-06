import { withDbContext } from "./tenant-db";
import { getSmsProvider, type SmsProvider } from "./sms";

export type AppointmentTemplate =
  | "booking_confirmed" | "booking_pending" | "booking_declined"
  | "booking_cancelled" | "booking_rescheduled";

type Vars = { clinic: string; when: string; link: string };
const texts: Record<AppointmentTemplate, Record<"sq" | "en", (p: Vars) => string>> = {
  booking_confirmed: {
    sq: (p) => `Dentbook: termini u konfirmua te ${p.clinic} më ${p.when}. Menaxho: ${p.link}`,
    en: (p) => `Dentbook: your appointment at ${p.clinic} on ${p.when} is confirmed. Manage: ${p.link}`,
  },
  booking_pending: {
    sq: (p) => `Dentbook: kërkesa u dërgua te ${p.clinic} për ${p.when}. Statusi: ${p.link}`,
    en: (p) => `Dentbook: your request to ${p.clinic} for ${p.when} was sent. Status: ${p.link}`,
  },
  booking_declined: {
    sq: (p) => `Dentbook: ${p.clinic} nuk e pranoi kërkesën për ${p.when}.`,
    en: (p) => `Dentbook: ${p.clinic} declined your request for ${p.when}.`,
  },
  booking_cancelled: {
    sq: (p) => `Dentbook: termini te ${p.clinic} më ${p.when} u anulua.`,
    en: (p) => `Dentbook: your appointment at ${p.clinic} on ${p.when} was cancelled.`,
  },
  booking_rescheduled: {
    sq: (p) => `Dentbook: termini te ${p.clinic} u zhvendos më ${p.when}. Menaxho: ${p.link}`,
    en: (p) => `Dentbook: your appointment at ${p.clinic} moved to ${p.when}. Manage: ${p.link}`,
  },
};

/** Outbox-backed SMS: one notifications row per send, SENT or FAILED. */
export async function notifyAppointment(
  template: AppointmentTemplate,
  appointmentId: string,
  provider: SmsProvider = getSmsProvider(),
) {
  const appt = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true, clinic: true },
    }));
  if (!appt?.patient.phone) return null;
  const phone = appt.patient.phone;

  const locale = appt.patient.locale === "en" ? "en" : "sq";
  const when = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sq-AL", {
    timeZone: appt.clinic.timezone, dateStyle: "short", timeStyle: "short",
  }).format(appt.startsAt);
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/manage/${appt.manageToken}`;
  const message = texts[template][locale]({ clinic: appt.clinic.name, when, link });

  const row = await withDbContext({ role: "auth" }, (tx) =>
    tx.notification.create({
      data: { clinicId: appt.clinicId, channel: "SMS", recipient: phone,
              template, payload: { appointmentId }, scheduledAt: new Date() },
    }));
  try {
    const { providerRef } = await provider.send(phone, message);
    return await withDbContext({ role: "auth" }, (tx) =>
      tx.notification.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: new Date(), providerRef },
      }));
  } catch {
    return await withDbContext({ role: "auth" }, (tx) =>
      tx.notification.update({
        where: { id: row.id }, data: { status: "FAILED" },
      }));
  }
}
