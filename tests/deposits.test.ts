import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { rejectionOf } from "./helpers/rejection";
import { createBooking, type BookingError } from "@/lib/booking";
import { startDeposit, applyDepositOutcome, handleDepositWebhook,
         expireUnpaidDeposits, getDepositForAppointment, getCheckoutByToken,
         DepositError } from "@/lib/deposits";
import { cancelViaToken } from "@/lib/manage";
import { cancelAppointmentByStaff, declineAppointment,
         expireStalePending } from "@/lib/appointment-actions";
import { MockPaymentProvider } from "@/lib/payments/mock";
import type { PaymentProvider } from "@/lib/payments/types";

// Friday 2027-01-15. Europe/Belgrade is UTC+1 in January and the dentist
// works 09:00–17:00 wall time, so 08:00Z is the first slot of the day.
const AT_9 = "2027-01-15T08:00:00.000Z";
const AT_10 = "2027-01-15T09:00:00.000Z";
const MIN = 60_000;

interface Fixture {
  slug: string; clinicId: string; drId: string;
  staff: { userId: string; clinicId: string };
  withDeposit: string; noDeposit: string;
}
let instant: Fixture, approval: Fixture;
let patientId: string, otherPatientId: string;

async function seedClinic(slug: string, bookingMode: "INSTANT" | "APPROVAL"): Promise<Fixture> {
  const clinic = await direct.clinic.create({
    data: { slug, name: slug, city: "P", address: "x", phone: "x",
            published: true, bookingMode } });
  const owner = await direct.user.create({
    data: { name: "O", email: `${slug}-o@x.com`, passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  const du = await direct.user.create({
    data: { name: "Dr", email: `${slug}-dr@x.com`, passwordHash: "x" } });
  const dr = await direct.membership.create({
    data: { userId: du.id, clinicId: clinic.id, role: "DENTIST" } });
  await direct.schedule.create({
    data: { membershipId: dr.id, weekday: 5, startMin: 540, endMin: 1020 } });
  const withDeposit = await direct.service.create({
    data: { clinicId: clinic.id, nameSq: "Mbushje", nameEn: "Filling",
            durationMin: 30, priceEur: 40, depositEur: 10 } });
  const noDeposit = await direct.service.create({
    data: { clinicId: clinic.id, nameSq: "Kontroll", nameEn: "Check-up",
            durationMin: 30, priceEur: 20 } });
  return { slug, clinicId: clinic.id, drId: dr.id,
           staff: { userId: owner.id, clinicId: clinic.id },
           withDeposit: withDeposit.id, noDeposit: noDeposit.id };
}

function book(f: Fixture, serviceId: string, startsAtISO: string, who = patientId) {
  return createBooking({ clinicSlug: f.slug, serviceId, membershipId: f.drId,
                         patientUserId: who, startsAtISO });
}
const paymentOf = (appointmentId: string) =>
  direct.payment.findUniqueOrThrow({ where: { appointmentId } });
const statusOf = async (appointmentId: string) =>
  (await direct.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status;
const smsTemplatesFor = async (appointmentId: string) =>
  (await direct.notification.findMany({
    where: { payload: { path: ["appointmentId"], equals: appointmentId } } }))
    .map((n) => n.template);

/** Books the deposit service and pays for it. */
async function bookAndPay(f: Fixture, startsAtISO = AT_9) {
  const b = await book(f, f.withDeposit, startsAtISO);
  await startDeposit(b.appointmentId);
  await applyDepositOutcome((await paymentOf(b.appointmentId)).providerRef!, "SUCCEEDED");
  return b;
}

beforeEach(async () => {
  await truncateAll();
  instant = await seedClinic("dp-instant", "INSTANT");
  approval = await seedClinic("dp-approval", "APPROVAL");
  patientId = (await direct.user.create({
    data: { name: "P", phone: "+38344610001" } })).id;
  otherPatientId = (await direct.user.create({
    data: { name: "Q", phone: "+38344610002" } })).id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("booking a service with a deposit", () => {
  it("holds the slot as AWAITING_PAYMENT instead of confirming it", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    expect(b.status).toBe("AWAITING_PAYMENT");
    const err = await rejectionOf(book(instant, instant.withDeposit, AT_9, otherPatientId));
    expect((err as BookingError).code).toBe("SLOT_TAKEN");
  });

  it("leaves a service without a deposit exactly as before", async () => {
    const b = await book(instant, instant.noDeposit, AT_9);
    expect(b.status).toBe("CONFIRMED");
    expect(await startDeposit(b.appointmentId)).toBeNull();
    expect(await direct.payment.count()).toBe(0);
  });
});

describe("startDeposit", () => {
  it("opens a PENDING payment for the deposit, checked out via the manage token", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    const checkout = await startDeposit(b.appointmentId);
    expect(checkout?.checkoutUrl).toBe(`/pay/${b.manageToken}`);
    const p = await paymentOf(b.appointmentId);
    expect(Number(p.amountEur)).toBe(10);
    expect(p.status).toBe("PENDING");
    expect(p.clinicId).toBe(instant.clinicId);
    expect(p.providerRef).toMatch(/^mock_/);
  });

  it("if the checkout can't be created, the hold still expires", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    const down: PaymentProvider = {
      name: "down",
      async createCheckout() { throw new Error("provider down"); },
      async handleWebhook() { throw new Error("unused"); },
      async refund() { throw new Error("unused"); },
    };
    await expect(startDeposit(b.appointmentId, down)).rejects.toThrow("provider down");
    await expireUnpaidDeposits(new Date(Date.now() + 16 * MIN));
    expect(await statusOf(b.appointmentId)).toBe("CANCELLED");
  });
});

describe("payment outcome", () => {
  it("confirms an instant booking and only then sends the confirmation SMS", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(b.appointmentId);
    expect(await smsTemplatesFor(b.appointmentId)).toEqual([]);

    const { providerRef } = await paymentOf(b.appointmentId);
    await handleDepositWebhook({ providerRef, outcome: "SUCCEEDED" }, new MockPaymentProvider());

    expect((await paymentOf(b.appointmentId)).status).toBe("SUCCEEDED");
    expect(await statusOf(b.appointmentId)).toBe("CONFIRMED");
    expect(await smsTemplatesFor(b.appointmentId)).toEqual(["booking_confirmed"]);
  });

  it("turns an approval-mode booking into a request for the clinic", async () => {
    const b = await bookAndPay(approval);
    expect(await statusOf(b.appointmentId)).toBe("PENDING");
    expect(await smsTemplatesFor(b.appointmentId)).toEqual(["booking_pending"]);
  });

  it("a failed payment cancels the hold and frees the slot", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(b.appointmentId);
    await applyDepositOutcome((await paymentOf(b.appointmentId)).providerRef!, "FAILED");
    expect((await paymentOf(b.appointmentId)).status).toBe("FAILED");
    expect(await statusOf(b.appointmentId)).toBe("CANCELLED");
    const again = await book(instant, instant.noDeposit, AT_9, otherPatientId);
    expect(again.status).toBe("CONFIRMED");
  });

  it("ignores a repeated webhook, so the patient gets one SMS", async () => {
    const b = await bookAndPay(instant);
    await applyDepositOutcome((await paymentOf(b.appointmentId)).providerRef!, "SUCCEEDED");
    expect(await smsTemplatesFor(b.appointmentId)).toEqual(["booking_confirmed"]);
  });

  it("refunds money that lands after the hold already expired", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(b.appointmentId);
    await expireUnpaidDeposits(new Date(Date.now() + 16 * MIN));
    await applyDepositOutcome((await paymentOf(b.appointmentId)).providerRef!, "SUCCEEDED");
    expect((await paymentOf(b.appointmentId)).status).toBe("REFUNDED");
    expect(await statusOf(b.appointmentId)).toBe("CANCELLED");
    expect(await smsTemplatesFor(b.appointmentId)).toEqual([]);
  });

  it("rejects an outcome for a payment it doesn't know", async () => {
    const err = await rejectionOf(applyDepositOutcome("mock_unknown", "SUCCEEDED"));
    expect(err).toBeInstanceOf(DepositError);
    expect((err as DepositError).code).toBe("NOT_FOUND");
  });
});

describe("expireUnpaidDeposits", () => {
  it("releases holds older than 15 minutes and leaves fresh ones", async () => {
    const stale = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(stale.appointmentId);
    const fresh = await book(instant, instant.withDeposit, AT_10);
    await startDeposit(fresh.appointmentId);
    const now = new Date();
    await direct.appointment.update({ where: { id: stale.appointmentId },
      data: { createdAt: new Date(now.getTime() - 16 * MIN) } });
    await direct.appointment.update({ where: { id: fresh.appointmentId },
      data: { createdAt: new Date(now.getTime() - 14 * MIN) } });

    expect(await expireUnpaidDeposits(now)).toBe(1);

    expect(await statusOf(stale.appointmentId)).toBe("CANCELLED");
    expect((await paymentOf(stale.appointmentId)).status).toBe("FAILED");
    expect(await statusOf(fresh.appointmentId)).toBe("AWAITING_PAYMENT");
    expect((await paymentOf(fresh.appointmentId)).status).toBe("PENDING");
  });

  it("a new booking attempt releases an expired hold on its slot", async () => {
    const stale = await book(instant, instant.withDeposit, AT_9);
    await direct.appointment.update({ where: { id: stale.appointmentId },
      data: { createdAt: new Date(Date.now() - 16 * MIN) } });
    const again = await book(instant, instant.noDeposit, AT_9, otherPatientId);
    expect(again.status).toBe("CONFIRMED");
  });
});

describe("cancellation settles the deposit", () => {
  it("refunds a paid deposit when the patient cancels via the manage link", async () => {
    const b = await bookAndPay(instant);
    await cancelViaToken(b.manageToken);
    expect((await paymentOf(b.appointmentId)).status).toBe("REFUNDED");
  });

  it("marks an unpaid deposit FAILED — nothing was taken, so nothing is refunded", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(b.appointmentId);
    await cancelViaToken(b.manageToken);
    expect(await statusOf(b.appointmentId)).toBe("CANCELLED");
    expect((await paymentOf(b.appointmentId)).status).toBe("FAILED");
  });

  it("refunds when the clinic cancels", async () => {
    const b = await bookAndPay(instant);
    await cancelAppointmentByStaff(instant.staff, b.appointmentId);
    expect((await paymentOf(b.appointmentId)).status).toBe("REFUNDED");
  });

  it("refunds when the clinic declines the request", async () => {
    const b = await bookAndPay(approval);
    await declineAppointment(approval.staff, b.appointmentId);
    expect((await paymentOf(b.appointmentId)).status).toBe("REFUNDED");
  });

  it("refunds when an unanswered request expires", async () => {
    const b = await bookAndPay(approval);
    await expireStalePending(approval.staff, new Date("2027-01-16T00:00:00Z"));
    expect(await statusOf(b.appointmentId)).toBe("DECLINED");
    expect((await paymentOf(b.appointmentId)).status).toBe("REFUNDED");
  });
});

describe("reading the deposit", () => {
  it("getDepositForAppointment reports it to the booking's own patient only", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(b.appointmentId);
    expect(await getDepositForAppointment(b.appointmentId, patientId))
      .toEqual({ amountEur: 10, status: "PENDING" });
    expect(await getDepositForAppointment(b.appointmentId, otherPatientId)).toBeNull();
  });

  it("getCheckoutByToken resolves the pending checkout for the pay page", async () => {
    const b = await book(instant, instant.withDeposit, AT_9);
    await startDeposit(b.appointmentId);
    const c = await getCheckoutByToken(b.manageToken);
    expect(c?.payment).toMatchObject({ status: "PENDING", amountEur: 10 });
    expect(c?.appointment.clinic.name).toBe("dp-instant");
    expect(await getCheckoutByToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
