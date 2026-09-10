import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { rolloverSubscriptions, markInvoicePaid, setPlan,
         listSubscriptionsForAdmin, getClinicBillingStatus,
         PLAN_PRICE_EUR } from "@/lib/billing";

const NOW = new Date("2027-03-10T12:00:00Z");
const d = (iso: string) => new Date(iso);
let adminId: string;
let n = 0;

async function clinicWith(sub: {
  plan: "TRIAL" | "BASIC" | "PRO";
  status?: "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt?: Date; currentPeriodEnd?: Date;
}) {
  n++;
  const c = await direct.clinic.create({
    data: { slug: `bl-${n}`, name: `Bl ${n}`, city: "P", address: "x",
            phone: "x", published: true } });
  const s = await direct.subscription.create({
    data: { clinicId: c.id, plan: sub.plan, status: sub.status ?? "ACTIVE",
            trialEndsAt: sub.trialEndsAt ?? null,
            currentPeriodEnd: sub.currentPeriodEnd ?? null } });
  return { clinicId: c.id, subscriptionId: s.id };
}
const invoicesOf = (subscriptionId: string) =>
  direct.invoice.findMany({ where: { subscriptionId }, orderBy: { periodStart: "asc" } });
const subOf = (id: string) => direct.subscription.findUniqueOrThrow({ where: { id } });
const periods = async (subscriptionId: string) =>
  (await invoicesOf(subscriptionId)).map((i) =>
    [i.periodStart.toISOString(), i.periodEnd.toISOString()]);

beforeEach(async () => {
  await truncateAll();
  adminId = (await direct.user.create({
    data: { name: "A", email: "bl-a@x.com", passwordHash: "x",
            isPlatformAdmin: true } })).id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("rolloverSubscriptions", () => {
  it("converts an ended trial to BASIC and invoices from the day the trial ended", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "TRIAL", trialEndsAt: d("2027-03-01T00:00:00Z") });
    await rolloverSubscriptions(NOW);
    const s = await subOf(subscriptionId);
    expect(s.plan).toBe("BASIC");
    expect(s.currentPeriodEnd).toEqual(d("2027-04-01T00:00:00Z"));
    expect(await periods(subscriptionId))
      .toEqual([["2027-03-01T00:00:00.000Z", "2027-04-01T00:00:00.000Z"]]);
    const [inv] = await invoicesOf(subscriptionId);
    expect(inv.status).toBe("OPEN");
    expect(Number(inv.amountEur)).toBe(PLAN_PRICE_EUR.BASIC);
    expect(s.status).toBe("ACTIVE"); // still inside the grace period
  });

  it("leaves a running trial alone", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "TRIAL", trialEndsAt: d("2027-03-20T00:00:00Z") });
    await rolloverSubscriptions(NOW);
    expect((await subOf(subscriptionId)).plan).toBe("TRIAL");
    expect(await invoicesOf(subscriptionId)).toHaveLength(0);
  });

  it("catches up every missed month with one invoice each", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-01-01T00:00:00Z") });
    await rolloverSubscriptions(NOW);
    expect(await periods(subscriptionId)).toEqual([
      ["2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z"],
      ["2027-02-01T00:00:00.000Z", "2027-03-01T00:00:00.000Z"],
      ["2027-03-01T00:00:00.000Z", "2027-04-01T00:00:00.000Z"],
    ]);
    expect((await subOf(subscriptionId)).currentPeriodEnd)
      .toEqual(d("2027-04-01T00:00:00Z"));
  });

  it("clamps to the end of a short month instead of spilling into the next", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "TRIAL", trialEndsAt: d("2027-01-31T00:00:00Z") });
    await rolloverSubscriptions(d("2027-02-10T00:00:00Z"));
    expect(await periods(subscriptionId))
      .toEqual([["2027-01-31T00:00:00.000Z", "2027-02-28T00:00:00.000Z"]]);
  });

  it("flags PAST_DUE once an invoice is unpaid 14 days after its period started", async () => {
    const overdue = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-04-01T00:00:00Z") });
    const inGrace = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-04-01T00:00:00Z") });
    // NOW is 03-10 12:00Z — 14 days after 02-24 has passed, after 02-25 not yet.
    await direct.invoice.create({ data: {
      subscriptionId: overdue.subscriptionId, amountEur: 29,
      periodStart: d("2027-02-24T00:00:00Z"), periodEnd: d("2027-03-24T00:00:00Z") } });
    await direct.invoice.create({ data: {
      subscriptionId: inGrace.subscriptionId, amountEur: 29,
      periodStart: d("2027-02-25T00:00:00Z"), periodEnd: d("2027-03-25T00:00:00Z") } });

    const r = await rolloverSubscriptions(NOW);

    expect((await subOf(overdue.subscriptionId)).status).toBe("PAST_DUE");
    expect((await subOf(inGrace.subscriptionId)).status).toBe("ACTIVE");
    expect(r.pastDue).toBe(1);
  });

  it("issues no duplicate invoices when run twice", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-02-01T00:00:00Z") });
    await rolloverSubscriptions(NOW);
    const second = await rolloverSubscriptions(NOW);
    expect(await invoicesOf(subscriptionId)).toHaveLength(2);
    expect(second.invoicesIssued).toBe(0);
  });

  it("never invoices a cancelled subscription", async () => {
    const { subscriptionId } = await clinicWith({
      plan: "BASIC", status: "CANCELLED", currentPeriodEnd: d("2027-01-01T00:00:00Z") });
    await rolloverSubscriptions(NOW);
    expect(await invoicesOf(subscriptionId)).toHaveLength(0);
    expect((await subOf(subscriptionId)).status).toBe("CANCELLED");
  });
});

describe("markInvoicePaid", () => {
  it("restores ACTIVE only once no overdue invoice remains", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-01-01T00:00:00Z") });
    await rolloverSubscriptions(NOW); // Jan + Feb overdue, Mar still in grace
    expect((await subOf(subscriptionId)).status).toBe("PAST_DUE");
    const [jan, feb] = await invoicesOf(subscriptionId);

    await markInvoicePaid({ userId: adminId }, jan.id, NOW);
    expect((await subOf(subscriptionId)).status).toBe("PAST_DUE");

    await markInvoicePaid({ userId: adminId }, feb.id, NOW);
    expect((await subOf(subscriptionId)).status).toBe("ACTIVE");

    const paid = await direct.invoice.findUniqueOrThrow({ where: { id: jan.id } });
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).toEqual(NOW);
  });
});

describe("setPlan", () => {
  it("bills the new plan's price from the next period", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-03-01T00:00:00Z") });
    await setPlan({ userId: adminId }, subscriptionId, "PRO");
    await rolloverSubscriptions(NOW);
    const [inv] = await invoicesOf(subscriptionId);
    expect(Number(inv.amountEur)).toBe(PLAN_PRICE_EUR.PRO);
  });

  it("starts billing straight away when a trial is moved to a paid plan", async () => {
    const { subscriptionId } = await clinicWith(
      { plan: "TRIAL", trialEndsAt: d("2027-03-20T00:00:00Z") });
    await setPlan({ userId: adminId }, subscriptionId, "PRO");
    await rolloverSubscriptions(NOW);
    const invoices = await invoicesOf(subscriptionId);
    expect(invoices.map((i) => i.periodStart)).toEqual([NOW]);
    expect(Number(invoices[0].amountEur)).toBe(PLAN_PRICE_EUR.PRO);
  });
});

describe("listSubscriptionsForAdmin", () => {
  it("lists every clinic's subscription with its open invoices", async () => {
    const paying = await clinicWith(
      { plan: "BASIC", currentPeriodEnd: d("2027-02-01T00:00:00Z") });
    const trial = await clinicWith(
      { plan: "TRIAL", trialEndsAt: d("2027-06-01T00:00:00Z") });
    await rolloverSubscriptions(NOW); // paying: Feb + Mar invoices
    const rows = new Map((await listSubscriptionsForAdmin({ userId: adminId }))
      .map((r) => [r.id, r]));
    expect(rows.get(paying.subscriptionId)?.invoices).toHaveLength(2);
    expect(rows.get(trial.subscriptionId)?.invoices).toHaveLength(0);
    expect(rows.get(paying.subscriptionId)?.clinic.name).toMatch(/^Bl /);
  });
});

describe("getClinicBillingStatus", () => {
  it("reports the clinic's own plan and status to its staff", async () => {
    const { clinicId } = await clinicWith({
      plan: "BASIC", status: "PAST_DUE", currentPeriodEnd: d("2027-04-01T00:00:00Z") });
    const owner = await direct.user.create({
      data: { name: "O", email: "bl-o@x.com", passwordHash: "x" } });
    await direct.membership.create({ data: { userId: owner.id, clinicId, role: "OWNER" } });
    expect(await getClinicBillingStatus({ userId: owner.id, clinicId }))
      .toMatchObject({ plan: "BASIC", status: "PAST_DUE" });
  });
});
