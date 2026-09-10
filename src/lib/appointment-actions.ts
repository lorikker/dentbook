import { withDbContext, type DbContext } from "./tenant-db";
import { notifyAppointment } from "./notify";
import { settleDepositOnCancel } from "./deposits";
import type { AppointmentStatus } from "@/generated/prisma/client";

export class TransitionError extends Error {
  constructor(public code: "NOT_FOUND" | "INVALID_TRANSITION") { super(code); }
}

type StaffCtx = { userId: string; clinicId: string };
const ctxOf = (c: StaffCtx) =>
  ({ role: "staff" as const, userId: c.userId, clinicId: c.clinicId });

/** target status → statuses it may come from (spec §6 status machine). */
const allowedFrom: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  CONFIRMED: ["PENDING"],
  DECLINED: ["PENDING"],
  CANCELLED: ["PENDING", "CONFIRMED"],
  COMPLETED: ["CONFIRMED"],
  NO_SHOW: ["CONFIRMED"],
};

async function transition(ctx: StaffCtx, id: string, to: AppointmentStatus) {
  return withDbContext(ctxOf(ctx), async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id } });
    if (!appt) throw new TransitionError("NOT_FOUND"); // RLS hides other tenants
    if (!allowedFrom[to]?.includes(appt.status)) {
      throw new TransitionError("INVALID_TRANSITION");
    }
    return tx.appointment.update({ where: { id }, data: { status: to } });
  });
}

export async function acceptAppointment(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "CONFIRMED");
  await notifyAppointment("booking_confirmed", a.id);
  return a;
}

export async function declineAppointment(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "DECLINED");
  await settleDepositOnCancel(ctxOf(ctx), a.id);
  await notifyAppointment("booking_declined", a.id);
  return a;
}

export async function cancelAppointmentByStaff(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "CANCELLED");
  await settleDepositOnCancel(ctxOf(ctx), a.id);
  await notifyAppointment("booking_cancelled", a.id);
  return a;
}

export async function completeAppointment(ctx: StaffCtx, id: string) {
  const a = await transition(ctx, id, "COMPLETED");
  // Spec §8: completion sends the review link — reviews are verified-only.
  await notifyAppointment("review_invite", a.id);
  return a;
}

export async function markNoShow(ctx: StaffCtx, id: string) {
  return transition(ctx, id, "NO_SHOW");
}

async function expirePending(dbCtx: DbContext, clinicId: string | undefined, now: Date) {
  const stale = await withDbContext(dbCtx, (tx) =>
    tx.appointment.findMany({
      where: { ...(clinicId ? { clinicId } : {}), status: "PENDING",
               startsAt: { lt: now } },
      select: { id: true } }));
  if (stale.length === 0) return { count: 0 };
  const ids = stale.map((a) => a.id);
  const result = await withDbContext(dbCtx, (tx) =>
    tx.appointment.updateMany({
      where: { id: { in: ids }, status: "PENDING" }, data: { status: "DECLINED" } }));
  for (const id of ids) await settleDepositOnCancel(dbCtx, id);
  return result;
}

/** Pending requests whose start passed without a decision expire as DECLINED. */
export async function expireStalePending(ctx: StaffCtx, now = new Date()) {
  return expirePending(ctxOf(ctx), ctx.clinicId, now);
}

/** The same sweep across every clinic, for the scheduled job. */
export async function expireStalePendingForAllClinics(now = new Date()) {
  return expirePending({ role: "admin" }, undefined, now);
}
