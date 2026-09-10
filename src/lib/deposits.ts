import type { Payment } from "@/generated/prisma/client";
import { withDbContext, type DbContext } from "./tenant-db";
import { notifyAppointment } from "./notify";
import { getPaymentProvider } from "./payments";
import type { PaymentProvider, PaymentOutcome } from "./payments/types";

export class DepositError extends Error {
  constructor(public code: "NOT_FOUND") { super(code); }
}

/** How long an unpaid deposit may hold a slot before it is released. */
export const DEPOSIT_HOLD_MINUTES = 15;

// Webhooks and the expiry sweep are platform work: a webhook is authenticated
// by the provider rather than by a session, so there is no user or clinic to
// scope the query to.
const SYSTEM: DbContext = { role: "admin" };

const asPatient = (patientUserId: string): DbContext =>
  ({ role: "patient", userId: patientUserId });

/**
 * Opens the deposit checkout for an AWAITING_PAYMENT appointment.
 * Null when nothing is due (the service has no deposit).
 */
export async function startDeposit(
  appointmentId: string, provider: PaymentProvider = getPaymentProvider(),
) {
  const appt = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findUnique({ where: { id: appointmentId }, include: { service: true } }));
  if (!appt) throw new DepositError("NOT_FOUND");
  const amountEur = Number(appt.service.depositEur ?? 0);
  if (appt.status !== "AWAITING_PAYMENT" || amountEur <= 0) return null;

  // Recorded before the provider is called, so an attempt that dies
  // mid-checkout is still on record. The hold lapses either way —
  // expireUnpaidDeposits keys on the appointment, not on this row.
  const payment = await withDbContext(asPatient(appt.patientUserId), (tx) =>
    tx.payment.create({
      data: { clinicId: appt.clinicId, appointmentId: appt.id,
              amountEur, provider: provider.name } }));
  const session = await provider.createCheckout({
    reference: appt.manageToken, amountEur, description: appt.service.nameEn });
  await withDbContext(asPatient(appt.patientUserId), (tx) =>
    tx.payment.update({
      where: { id: payment.id }, data: { providerRef: session.providerRef } }));
  return { paymentId: payment.id, checkoutUrl: session.checkoutUrl };
}

async function refund(ctx: DbContext, payment: Payment, provider: PaymentProvider) {
  try {
    if (payment.providerRef) {
      await provider.refund(payment.providerRef, Number(payment.amountEur));
    }
  } catch (e) {
    // The cancellation that triggered this must still stand. A SUCCEEDED
    // payment left on a cancelled appointment is the visible "refund owed".
    console.error(`refund of payment ${payment.id} failed`, e);
    return;
  }
  await withDbContext(ctx, (tx) =>
    tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }));
}

/**
 * Applies a normalised payment result. Safe to repeat — providers retry
 * webhooks. Money that lands after its hold lapsed is refunded rather than
 * reviving the appointment: the slot may belong to someone else by now.
 */
export async function applyDepositOutcome(
  providerRef: string, outcome: PaymentOutcome,
  provider: PaymentProvider = getPaymentProvider(),
): Promise<void> {
  const payment = await withDbContext(SYSTEM, (tx) =>
    tx.payment.findFirst({ where: { providerRef } }));
  if (!payment?.appointmentId) throw new DepositError("NOT_FOUND");
  const appointmentId = payment.appointmentId;

  if (outcome === "FAILED") {
    await withDbContext(SYSTEM, async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      if (count === 0) return;
      await tx.appointment.updateMany({
        where: { id: appointmentId, status: "AWAITING_PAYMENT" },
        data: { status: "CANCELLED" } });
    });
    return;
  }

  // Claim the success exactly once. FAILED is claimable too: the sweep may
  // have expired the hold while the patient was still paying.
  const result = await withDbContext(SYSTEM, async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SUCCEEDED" } });
    if (count === 0) return "duplicate" as const;
    const appt = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId }, include: { clinic: true } });
    if (appt.status !== "AWAITING_PAYMENT") return "lapsed" as const;
    const next = appt.clinic.bookingMode === "INSTANT" ? "CONFIRMED" : "PENDING";
    await tx.appointment.update({ where: { id: appointmentId }, data: { status: next } });
    return next;
  });

  if (result === "duplicate") return;
  if (result === "lapsed") {
    await refund(SYSTEM, { ...payment, status: "SUCCEEDED" }, provider);
    return;
  }
  // The confirmation SMS was held back at booking time; this is its moment.
  await notifyAppointment(
    result === "CONFIRMED" ? "booking_confirmed" : "booking_pending", appointmentId);
}

/** Entry point for provider webhooks (the mock's comes from the /pay page). */
export async function handleDepositWebhook(
  payload: unknown, provider: PaymentProvider = getPaymentProvider(),
) {
  const { providerRef, outcome } = await provider.handleWebhook(payload);
  await applyDepositOutcome(providerRef, outcome, provider);
}

/** Releases holds left unpaid past DEPOSIT_HOLD_MINUTES; returns how many. */
export async function expireUnpaidDeposits(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEPOSIT_HOLD_MINUTES * 60_000);
  return withDbContext(SYSTEM, async (tx) => {
    const lapsed = await tx.appointment.findMany({
      where: { status: "AWAITING_PAYMENT", createdAt: { lt: cutoff } },
      select: { id: true } });
    if (lapsed.length === 0) return 0;
    const ids = lapsed.map((a) => a.id);
    const { count } = await tx.appointment.updateMany({
      where: { id: { in: ids }, status: "AWAITING_PAYMENT" },
      data: { status: "CANCELLED" } });
    await tx.payment.updateMany({
      where: { appointmentId: { in: ids }, status: "PENDING" },
      data: { status: "FAILED" } });
    return count;
  });
}

/**
 * Called whenever an appointment is cancelled or declined: a captured
 * deposit is refunded, an unpaid one is closed as FAILED (nothing was taken).
 */
export async function settleDepositOnCancel(
  ctx: DbContext, appointmentId: string,
  provider: PaymentProvider = getPaymentProvider(),
) {
  const payment = await withDbContext(ctx, (tx) =>
    tx.payment.findUnique({ where: { appointmentId } }));
  if (payment?.status === "PENDING") {
    await withDbContext(ctx, (tx) =>
      tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } }));
  } else if (payment?.status === "SUCCEEDED") {
    await refund(ctx, payment, provider);
  }
}

/** The deposit on an appointment, as its own patient may see it. */
export async function getDepositForAppointment(appointmentId: string, patientUserId: string) {
  const p = await withDbContext(asPatient(patientUserId), (tx) =>
    tx.payment.findUnique({ where: { appointmentId } }));
  return p ? { amountEur: Number(p.amountEur), status: p.status } : null;
}

/** Everything the /pay page needs; the manage token is the capability. */
export async function getCheckoutByToken(token: string) {
  const appointment = await withDbContext({ role: "auth" }, (tx) =>
    tx.appointment.findUnique({
      where: { manageToken: token }, include: { clinic: true, service: true } }));
  if (!appointment) return null;
  const p = await withDbContext(asPatient(appointment.patientUserId), (tx) =>
    tx.payment.findUnique({ where: { appointmentId: appointment.id } }));
  if (!p) return null;
  return {
    appointment,
    payment: { id: p.id, status: p.status, amountEur: Number(p.amountEur),
               providerRef: p.providerRef },
  };
}
