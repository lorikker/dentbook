import type { Prisma, SubscriptionPlan, SubscriptionStatus } from "@/generated/prisma/client";
import { withDbContext, type DbContext } from "./tenant-db";

/**
 * Monthly price per plan, EUR. Spec §8: plans gate nothing in v1 — this is
 * the invoicing machinery (periods, invoices, "mark paid", overdue flag);
 * enforcement comes with a real payment provider.
 */
export const PLAN_PRICE_EUR: Record<SubscriptionPlan, number> = { TRIAL: 0, BASIC: 29, PRO: 59 };

/** An invoice still OPEN this long after its period starts flags PAST_DUE. */
export const GRACE_DAYS = 14;

/** Safety valve for a subscription left dormant for years. */
const MAX_CATCH_UP_PERIODS = 24;

// Rollover acts on every clinic at once — platform work, no tenant scope.
const SYSTEM: DbContext = { role: "admin" };

/** One calendar month later in UTC, clamped to the target month's last day. */
function addMonthUTC(d: Date): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/** Recomputes ACTIVE/PAST_DUE from the subscription's OPEN invoices. */
async function refreshStatus(
  tx: Prisma.TransactionClient,
  sub: { id: string; status: SubscriptionStatus }, now: Date,
): Promise<SubscriptionStatus> {
  if (sub.status === "CANCELLED") return sub.status;
  const graceStart = new Date(now.getTime() - GRACE_DAYS * 24 * 3600_000);
  const overdue = await tx.invoice.count({
    where: { subscriptionId: sub.id, status: "OPEN", periodStart: { lt: graceStart } } });
  const next: SubscriptionStatus = overdue > 0 ? "PAST_DUE" : "ACTIVE";
  if (next !== sub.status) {
    await tx.subscription.update({ where: { id: sub.id }, data: { status: next } });
  }
  return next;
}

/**
 * Converts ended trials to BASIC, issues one OPEN invoice per elapsed month
 * (catching up any it missed), and flags overdue clinics. Idempotent.
 */
export async function rolloverSubscriptions(now = new Date()) {
  const subs = await withDbContext(SYSTEM, (tx) =>
    tx.subscription.findMany({ where: { status: { not: "CANCELLED" } } }));
  let invoicesIssued = 0, pastDue = 0;
  for (const sub of subs) {
    const r = await withDbContext(SYSTEM, async (tx) => {
      let plan = sub.plan;
      let periodEnd = sub.currentPeriodEnd;
      if (plan === "TRIAL") {
        if (sub.trialEndsAt && sub.trialEndsAt <= now) {
          plan = "BASIC";             // the first paid period starts when the trial ends
          periodEnd = sub.trialEndsAt;
        }
      } else if (!periodEnd) {
        periodEnd = now;              // a paid plan with no period yet starts billing today
      }
      let issued = 0;
      while (plan !== "TRIAL" && periodEnd && periodEnd <= now
             && issued < MAX_CATCH_UP_PERIODS) {
        const next = addMonthUTC(periodEnd);
        await tx.invoice.create({ data: {
          subscriptionId: sub.id, amountEur: PLAN_PRICE_EUR[plan],
          periodStart: periodEnd, periodEnd: next } });
        periodEnd = next;
        issued++;
      }
      if (plan !== sub.plan || periodEnd?.getTime() !== sub.currentPeriodEnd?.getTime()) {
        await tx.subscription.update({
          where: { id: sub.id }, data: { plan, currentPeriodEnd: periodEnd } });
      }
      return { issued, status: await refreshStatus(tx, sub, now) };
    });
    invoicesIssued += r.issued;
    if (r.status === "PAST_DUE") pastDue++;
  }
  return { invoicesIssued, pastDue };
}

/** Admin "mark paid" (manual invoicing); clears PAST_DUE once nothing is overdue. */
export async function markInvoicePaid(
  ctx: { userId: string }, invoiceId: string, now = new Date(),
) {
  await withDbContext({ role: "admin", userId: ctx.userId }, async (tx) => {
    const { count } = await tx.invoice.updateMany({
      where: { id: invoiceId, status: "OPEN" }, data: { status: "PAID", paidAt: now } });
    if (count === 0) return; // already paid or void
    const inv = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId }, include: { subscription: true } });
    await refreshStatus(tx, inv.subscription, now);
  });
}

/**
 * Takes effect from the next invoice. A trial moved to a paid plan has no
 * period yet, so the next rollover starts billing on the day it runs.
 */
export async function setPlan(
  ctx: { userId: string }, subscriptionId: string, plan: "BASIC" | "PRO",
) {
  await withDbContext({ role: "admin", userId: ctx.userId }, (tx) =>
    tx.subscription.update({ where: { id: subscriptionId }, data: { plan } }));
}

export async function listSubscriptionsForAdmin(ctx: { userId: string }) {
  return withDbContext({ role: "admin", userId: ctx.userId }, (tx) =>
    tx.subscription.findMany({
      include: {
        clinic: { select: { name: true, slug: true } },
        invoices: { where: { status: "OPEN" }, orderBy: { periodStart: "asc" } },
      },
      orderBy: { clinic: { name: "asc" } } }));
}

/** For the dashboard's billing banner. */
export async function getClinicBillingStatus(ctx: { userId: string; clinicId: string }) {
  return withDbContext({ role: "staff", userId: ctx.userId, clinicId: ctx.clinicId }, (tx) =>
    tx.subscription.findUnique({
      where: { clinicId: ctx.clinicId },
      select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } }));
}
