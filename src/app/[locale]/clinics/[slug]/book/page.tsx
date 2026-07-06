import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations, getFormatter } from "next-intl/server";
import { auth, signIn } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { getAvailableSlots } from "@/lib/availability";
import { createBooking, BookingError } from "@/lib/booking";
import { rescheduleViaToken, ManageError } from "@/lib/manage";
import { requestOtp, OtpError } from "@/lib/otp";
import { notifyAppointment } from "@/lib/notify";

type Query = {
  serviceId?: string; membershipId?: string; date?: string; startsAt?: string;
  phone?: string; name?: string; sent?: string; error?: string; reschedule?: string;
};

export default async function BookPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<Query>;
}) {
  const { slug, locale } = await params;
  const q = await searchParams;
  const t = await getTranslations("Book");
  const format = await getFormatter();
  const session = await auth();
  const isPatient = session?.user?.kind === "patient";

  const clinic = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findFirst({
      where: { slug, published: true },
      include: {
        services: { where: { active: true }, orderBy: { nameSq: "asc" } },
        memberships: { where: { role: "DENTIST" },
                       include: { user: true }, orderBy: { createdAt: "asc" } },
      },
    }));
  if (!clinic) notFound();

  const service = clinic.services.find((s) => s.id === q.serviceId);
  const base = `/clinics/${slug}/book`;
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
      serviceId: q.serviceId, membershipId: q.membershipId, date: q.date,
      startsAt: q.startsAt, reschedule: q.reschedule, ...extra,
    })) if (v) p.set(k, v);
    return `${base}?${p.toString()}`;
  };

  // ---- server actions ----------------------------------------------------
  async function requestOtpAction(formData: FormData) {
    "use server";
    const f = (k: string) => String(formData.get(k) ?? "");
    const back = f("back");
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    try {
      await requestOtp(f("phone"), ip);
    } catch (e) {
      redirect(`${back}&error=${e instanceof OtpError ? e.code : "UNKNOWN"}`);
    }
    redirect(`${back}&phone=${encodeURIComponent(f("phone"))}&name=${encodeURIComponent(f("name"))}&sent=1`);
  }

  async function confirmAction(formData: FormData) {
    "use server";
    const f = (k: string) => String(formData.get(k) ?? "");
    const back = f("back");
    let userId: string | undefined;
    const s = await auth();
    if (s?.user?.kind === "patient") {
      userId = s.user.id;
    } else {
      try {
        await signIn("patient-otp", {
          phone: f("phone"), code: f("code"), name: f("name"), redirect: false });
      } catch {
        redirect(`${back}&phone=${encodeURIComponent(f("phone"))}&name=${encodeURIComponent(f("name"))}&sent=1&error=INVALID_CODE`);
      }
      // auth() can't see the cookie signIn just set within this same action;
      // signIn succeeding means the OTP for this phone was verified, so the
      // phone lookup is trusted.
      userId = (await auth())?.user?.id ??
        (await withDbContext({ role: "auth" }, (tx) =>
          tx.user.findUnique({ where: { phone: f("phone") } })))?.id;
    }
    if (!userId) redirect(`${back}&error=UNKNOWN`);

    let dest = "";
    try {
      const r = await createBooking({
        clinicSlug: f("slug"), serviceId: f("serviceId"),
        membershipId: f("membershipId"), patientUserId: userId!,
        startsAtISO: f("startsAt") });
      await notifyAppointment(
        r.status === "CONFIRMED" ? "booking_confirmed" : "booking_pending",
        r.appointmentId);
      dest = `/manage/${r.manageToken}?booked=1`;
    } catch (e) {
      redirect(`${back}&error=${e instanceof BookingError ? e.code : "UNKNOWN"}`);
    }
    redirect(dest);
  }

  async function rescheduleAction(formData: FormData) {
    "use server";
    const f = (k: string) => String(formData.get(k) ?? "");
    try {
      await rescheduleViaToken(f("reschedule"), f("startsAt"));
    } catch (e) {
      redirect(`${f("back")}&error=${e instanceof ManageError ? e.code : "UNKNOWN"}`);
    }
    redirect(`/manage/${f("reschedule")}?updated=1`);
  }
  // -------------------------------------------------------------------------

  const sName = (s: { nameSq: string; nameEn: string }) =>
    locale === "en" ? s.nameEn : s.nameSq;

  let body: React.ReactNode;
  if (!service) {
    // step 1: choose service
    body = (
      <ul className="flex flex-col gap-2">
        {clinic.services.map((s) => (
          <li key={s.id}>
            <Link href={keep({ serviceId: s.id })}
                  className="block rounded border p-3 hover:bg-gray-50">
              {sName(s)}
              <span className="ml-2 text-sm text-gray-500">
                {s.durationMin} min · {String(s.priceEur)} €
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  } else if (!q.membershipId) {
    // step 2: choose dentist (or any)
    body = (
      <ul className="flex flex-col gap-2">
        <li>
          <Link href={keep({ membershipId: "any" })}
                className="block rounded border p-3 font-medium hover:bg-gray-50">
            {t("anyDentist")}
          </Link>
        </li>
        {clinic.memberships.map((m) => (
          <li key={m.id}>
            <Link href={keep({ membershipId: m.id })}
                  className="block rounded border p-3 hover:bg-gray-50">
              {m.user?.name}{m.title ? ` · ${m.title}` : ""}
            </Link>
          </li>
        ))}
      </ul>
    );
  } else if (!q.date) {
    // step 3: pick a date (GET form back onto this page)
    body = (
      <form action={base} method="get" className="flex max-w-xs flex-col gap-2">
        {q.serviceId && <input type="hidden" name="serviceId" value={q.serviceId} />}
        <input type="hidden" name="membershipId" value={q.membershipId} />
        {q.reschedule && <input type="hidden" name="reschedule" value={q.reschedule} />}
        <input name="date" type="date" required className="rounded border p-2" />
        <button className="rounded bg-sky-600 p-2 text-white">{t("showSlots")}</button>
      </form>
    );
  } else if (!q.startsAt) {
    // step 4: pick a slot
    const slots = await getAvailableSlots({
      clinicSlug: slug, serviceId: service.id,
      membershipId: q.membershipId === "any" ? null : q.membershipId,
      dateISO: q.date });
    body = (
      <div>
        {slots.length === 0 && <p className="text-gray-500">{t("noSlots")}</p>}
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <Link key={`${s.membershipId}-${s.startsAt.toISOString()}`}
                  href={keep({ startsAt: s.startsAt.toISOString(),
                               membershipId: s.membershipId })}
                  className="rounded border px-3 py-2 font-mono text-sm hover:bg-gray-50">
              {format.dateTime(s.startsAt, {
                hour: "2-digit", minute: "2-digit",
                timeZone: clinic.timezone })}
            </Link>
          ))}
        </div>
        <p className="mt-4">
          <Link href={keep({ date: "" })} className="text-sm text-sky-700 underline">
            {t("otherDate")}
          </Link>
        </p>
      </div>
    );
  } else {
    // step 5: confirm — reschedule needs no identity; new bookings need OTP
    const back = keep({});
    const when = format.dateTime(new Date(q.startsAt), {
      dateStyle: "medium", timeStyle: "short", timeZone: clinic.timezone });
    const summary = (
      <p className="mb-4 rounded bg-gray-50 p-3">
        {sName(service)} — <span className="font-mono">{when}</span>
      </p>
    );
    if (q.reschedule) {
      body = (
        <div>
          {summary}
          <form action={rescheduleAction}>
            <input type="hidden" name="reschedule" value={q.reschedule} />
            <input type="hidden" name="startsAt" value={q.startsAt} />
            <input type="hidden" name="back" value={back} />
            <button className="rounded bg-sky-600 p-2 px-6 text-white">
              {t("confirmReschedule")}
            </button>
          </form>
        </div>
      );
    } else if (isPatient || q.sent) {
      body = (
        <div>
          {summary}
          <form action={confirmAction} className="flex max-w-xs flex-col gap-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="membershipId" value={q.membershipId} />
            <input type="hidden" name="startsAt" value={q.startsAt} />
            <input type="hidden" name="back" value={back} />
            {!isPatient && (
              <>
                <input type="hidden" name="phone" value={q.phone ?? ""} />
                <input type="hidden" name="name" value={q.name ?? ""} />
                <p className="text-sm text-gray-600">{t("codeSentTo", { phone: q.phone ?? "" })}</p>
                <input name="code" required maxLength={6} placeholder={t("code")}
                       className="rounded border p-2 font-mono" />
              </>
            )}
            <button className="rounded bg-sky-600 p-2 text-white">{t("confirm")}</button>
          </form>
        </div>
      );
    } else {
      body = (
        <div>
          {summary}
          <form action={requestOtpAction} className="flex max-w-xs flex-col gap-2">
            <input type="hidden" name="back" value={back} />
            <input name="name" required placeholder={t("yourName")}
                   className="rounded border p-2" />
            <input name="phone" type="tel" required placeholder={t("yourPhone")}
                   className="rounded border p-2" />
            <button className="rounded bg-sky-600 p-2 text-white">{t("sendCode")}</button>
          </form>
        </div>
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="mb-1 text-2xl font-bold">
        {q.reschedule ? t("rescheduleTitle") : t("title")}
      </h1>
      <p className="mb-6 text-gray-600">{clinic.name}</p>
      {q.error && (
        <p className="mb-4 text-sm text-red-600">{t(`errors.${q.error}` as never)}</p>
      )}
      {body}
    </main>
  );
}
