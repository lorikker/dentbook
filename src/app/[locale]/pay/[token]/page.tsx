import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { getCheckoutByToken, handleDepositWebhook,
         DEPOSIT_HOLD_MINUTES } from "@/lib/deposits";
import { Container } from "@/components/Container";

export default async function PayPage({
  params,
}: { params: Promise<{ token: string; locale: string }> }) {
  const { token, locale } = await params;
  const t = await getTranslations("Pay");
  const format = await getFormatter();
  const checkout = await getCheckoutByToken(token);
  if (!checkout) notFound();
  const { appointment: a, payment } = checkout;
  if (payment.status === "SUCCEEDED") redirect(`/manage/${token}?booked=1`);

  // The mock provider's "webhook": this page posts the outcome the patient
  // chose, the way a real gateway calls back after its hosted payment page.
  async function settle(outcome: "SUCCEEDED" | "FAILED") {
    "use server";
    const c = await getCheckoutByToken(token);
    if (c?.payment.providerRef && c.payment.status === "PENDING") {
      await handleDepositWebhook({ providerRef: c.payment.providerRef, outcome });
    }
    redirect(`/pay/${token}`);
  }

  const payable = payment.status === "PENDING" && a.status === "AWAITING_PAYMENT";
  const amount = format.number(payment.amountEur, { style: "currency", currency: "EUR" });
  const serviceName = locale === "en" ? a.service.nameEn : a.service.nameSq;

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <span className="border border-coral/40 px-2 py-0.5 text-xs font-bold tracking-[0.08em] text-coral">
          {t("testMode")}
        </span>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        {payable && (
          <p className="mt-2 text-muted">{t("subtitle", { minutes: DEPOSIT_HOLD_MINUTES })}</p>
        )}

        <div className="mt-6 border border-ink-line bg-ink-surface p-5">
          <p className="text-sm text-muted">{a.clinic.name} · {serviceName}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight">
            {format.dateTime(a.startsAt, {
              dateStyle: "medium", timeStyle: "short", timeZone: a.clinic.timezone })}
          </p>
          <div className="mt-4 flex items-baseline justify-between border-t border-ink-line pt-4">
            <span className="text-muted">{t("deposit")}</span>
            <span className="font-display text-3xl font-bold">{amount}</span>
          </div>
        </div>

        {payable ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <form action={settle.bind(null, "SUCCEEDED")}>
              <button className="bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
                {t("pay", { amount })}
              </button>
            </form>
            <form action={settle.bind(null, "FAILED")}>
              <button className="border border-ink-line px-5 py-3.5 text-base font-semibold text-cream transition-colors hover:border-ink-line-hover">
                {t("cancel")}
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-muted">
              {payment.status === "REFUNDED" ? t("refunded") : t("released")}
            </p>
            <Link
              href={`/clinics/${a.clinic.slug}/book?serviceId=${a.serviceId}`}
              className="mt-4 inline-block bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover"
            >
              {t("bookAgain")}
            </Link>
          </div>
        )}

        <p className="mt-10 text-xs text-muted-2">{t("mockNote")}</p>
      </Container>
    </div>
  );
}
