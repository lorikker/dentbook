import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { getAppointmentByToken, cancelViaToken, ManageError } from "@/lib/manage";

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
    <main className="mx-auto w-full max-w-md p-8">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      {banner && (
        <p className="mb-4 rounded bg-green-50 p-3 text-sm text-green-800">{banner}</p>
      )}
      {flags.error && (
        <p className="mb-4 text-sm text-red-600">{t(`errors.${flags.error}` as never)}</p>
      )}
      <div className="mb-6 rounded border p-4">
        <p className="font-semibold">{a.clinic.name}</p>
        <p className="text-sm text-gray-600">{a.clinic.city} · {a.clinic.address}</p>
        <p className="mt-3">{serviceName} · {a.membership.user?.name}</p>
        <p className="font-mono">
          {format.dateTime(a.startsAt, {
            dateStyle: "full", timeStyle: "short", timeZone: a.clinic.timezone })}
        </p>
        <p className="mt-2">
          <span className="rounded bg-gray-100 px-2 py-1 text-sm">
            {t(`status.${a.status}` as never)}
          </span>
        </p>
      </div>
      {found.cancellable ? (
        <div className="flex gap-3">
          <form action={cancelAction}>
            <button className="rounded border border-red-600 px-4 py-2 text-red-600">
              {t("cancel")}
            </button>
          </form>
          <Link
            href={`/clinics/${a.clinic.slug}/book?reschedule=${token}&serviceId=${a.serviceId}&membershipId=${a.membershipId}`}
            className="rounded bg-sky-600 px-4 py-2 text-white">
            {t("reschedule")}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-500">{t("notChangeable")}</p>
      )}
    </main>
  );
}
