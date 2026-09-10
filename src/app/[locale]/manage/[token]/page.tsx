import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { getAppointmentByToken, cancelViaToken, ManageError } from "@/lib/manage";
import { getDepositForAppointment } from "@/lib/deposits";
import { Container } from "@/components/Container";

export default async function ManagePage({
  params, searchParams,
}: {
  params: Promise<{ token: string; locale: string }>;
  searchParams: Promise<{ booked?: string; updated?: string; cancelled?: string; error?: string }>;
}) {
  const { token, locale } = await params;
  const flags = await searchParams;
  const t = await getTranslations("Manage");
  const format = await getFormatter();
  const found = await getAppointmentByToken(token);
  if (!found) notFound();
  const a = found.appointment;
  const serviceName = locale === "en" ? a.service.nameEn : a.service.nameSq;
  const deposit = await getDepositForAppointment(a.id, a.patientUserId);

  async function cancelAction() {
    "use server";
    try {
      await cancelViaToken(token);
    } catch (e) {
      redirect(`/manage/${token}?error=${e instanceof ManageError ? e.code : "UNKNOWN"}`);
    }
    redirect(`/manage/${token}?cancelled=1`);
  }

  const banner =
    flags.booked ? t("bannerBooked")
    : flags.updated ? t("bannerUpdated")
    : flags.cancelled ? t("bannerCancelled")
    : null;

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        {banner && (
          <p className="mt-5 border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">{banner}</p>
        )}
        {flags.error && (
          <p className="mt-5 border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">
            {t(`errors.${flags.error}` as never)}
          </p>
        )}
        <div className="mt-6 border border-ink-line bg-ink-surface p-5">
          <p className="text-lg font-semibold">{a.clinic.name}</p>
          <p className="text-sm text-muted">{a.clinic.city} · {a.clinic.address}</p>
          <p className="mt-4">{serviceName} · {a.membership.user?.name}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight">
            {format.dateTime(a.startsAt, {
              dateStyle: "full", timeStyle: "short", timeZone: a.clinic.timezone })}
          </p>
          <p className="mt-3">
            <span className="border border-ink-line px-2.5 py-1 text-xs font-semibold tracking-[0.06em] text-muted">
              {t(`status.${a.status}` as never)}
            </span>
          </p>
          {deposit && (
            <p className="mt-3 text-sm text-muted">
              {t("deposit", {
                amount: format.number(deposit.amountEur, { style: "currency", currency: "EUR" }) })}
              {" · "}
              {t(`depositStatus.${deposit.status}` as never)}
            </p>
          )}
        </div>
        {a.status === "AWAITING_PAYMENT" && deposit?.status === "PENDING" && (
          <Link
            href={`/pay/${token}`}
            className="mt-6 inline-block bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover"
          >
            {t("payNow")}
          </Link>
        )}
        {found.cancellable ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <form action={cancelAction}>
              <button className="border border-coral px-4 py-3 text-sm font-semibold text-coral transition-colors hover:bg-coral/10">
                {t("cancel")}
              </button>
            </form>
            <Link
              href={`/clinics/${a.clinic.slug}/book?reschedule=${token}&serviceId=${a.serviceId}&membershipId=${a.membershipId}`}
              className="bg-accent px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">
              {t("reschedule")}
            </Link>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">{t("notChangeable")}</p>
        )}
      </Container>
    </div>
  );
}
