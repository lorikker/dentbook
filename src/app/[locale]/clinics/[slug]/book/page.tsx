import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations, getFormatter } from "next-intl/server";
import { auth, signIn } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { getAvailableSlots, getAvailableSlotsRange } from "@/lib/availability";
import { createBooking, BookingError, clinicLocalDateISO } from "@/lib/booking";
import { rescheduleViaToken, ManageError } from "@/lib/manage";
import { requestOtp, OtpError } from "@/lib/otp";
import { notifyAppointment } from "@/lib/notify";
import { Container } from "@/components/Container";

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

  const linkClass =
    "block border border-ink-line bg-ink-surface p-4 text-cream transition-colors hover:border-ink-line-hover";
  const inputClass =
    "border border-ink-line bg-ink px-3.5 py-3 text-cream outline-none placeholder:text-muted-2 focus:border-accent";
  const primaryBtnClass =
    "bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover";

  let step = 1;
  let body: React.ReactNode;
  if (!service) {
    step = 1;
    // step 1: choose service
    body = (
      <ul className="grid gap-2.5">
        {clinic.services.map((s) => (
          <li key={s.id}>
            <Link href={keep({ serviceId: s.id })} className={linkClass}>
              {sName(s)}
              <span className="ml-2 text-sm text-muted">
                {s.durationMin} min · {String(s.priceEur)} €
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  } else if (!q.membershipId) {
    step = 2;
    // step 2: choose dentist (or any)
    body = (
      <ul className="grid gap-2.5">
        <li>
          <Link href={keep({ membershipId: "any" })} className={`${linkClass} font-semibold`}>
            {t("anyDentist")}
          </Link>
        </li>
        {clinic.memberships.map((m) => (
          <li key={m.id}>
            <Link href={keep({ membershipId: m.id })} className={linkClass}>
              {m.user?.name}{m.title ? ` · ${m.title}` : ""}
            </Link>
          </li>
        ))}
      </ul>
    );
  } else if (!q.startsAt) {
    step = 3;
    // step 3: browse every free slot in the next 14 days, or narrow to one
    // day with the date filter (a GET form back onto this same page).
    const slotLink = (s: { startsAt: Date; membershipId: string }) => (
      <Link key={`${s.membershipId}-${s.startsAt.toISOString()}`}
            href={keep({ startsAt: s.startsAt.toISOString(),
                         membershipId: s.membershipId })}
            className="border border-ink-line bg-ink-surface py-3.5 text-center text-sm font-semibold transition-colors hover:border-accent">
        {format.dateTime(s.startsAt, {
          hour: "2-digit", minute: "2-digit",
          timeZone: clinic.timezone })}
      </Link>
    );

    let results: React.ReactNode;
    if (q.date) {
      const slots = await getAvailableSlots({
        clinicSlug: slug, serviceId: service.id,
        membershipId: q.membershipId === "any" ? null : q.membershipId,
        dateISO: q.date });
      results = (
        <div>
          {slots.length === 0 && <p className="text-muted">{t("noSlots")}</p>}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            {slots.map(slotLink)}
          </div>
          <p className="mt-5">
            <Link href={keep({ date: "" })} className="text-sm font-semibold text-accent hover:text-accent-hover">
              {t("showAllDates")}
            </Link>
          </p>
        </div>
      );
    } else {
      const fromDateISO = clinicLocalDateISO(new Date(), clinic.timezone);
      const [fy, fm, fd] = fromDateISO.split("-").map(Number);
      const toDateISO = new Date(Date.UTC(fy, fm - 1, fd + 13)).toISOString().slice(0, 10);
      const slots = await getAvailableSlotsRange({
        clinicSlug: slug, serviceId: service.id,
        membershipId: q.membershipId === "any" ? null : q.membershipId,
        fromDateISO, toDateISO });
      const groups = new Map<string, typeof slots>();
      for (const s of slots) {
        const day = clinicLocalDateISO(s.startsAt, clinic.timezone);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day)!.push(s);
      }
      results = (
        <div className="flex flex-col gap-6">
          {groups.size === 0 && <p className="text-muted">{t("noSlotsInRange")}</p>}
          {[...groups.values()].map((daySlots) => (
            <div key={daySlots[0].startsAt.toISOString()}>
              <h3 className="mb-2 font-display text-base font-bold">
                {format.dateTime(daySlots[0].startsAt, {
                  weekday: "short", month: "short", day: "numeric",
                  timeZone: clinic.timezone })}
              </h3>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {daySlots.map(slotLink)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    const dateFilter = (
      <form action={base} method="get" className="flex flex-col gap-3">
        {q.serviceId && <input type="hidden" name="serviceId" value={q.serviceId} />}
        <input type="hidden" name="membershipId" value={q.membershipId} />
        {q.reschedule && <input type="hidden" name="reschedule" value={q.reschedule} />}
        <label className="text-sm font-semibold text-muted">{t("filterByDate")}</label>
        <input name="date" type="date" defaultValue={q.date} className={inputClass} />
        <button className={primaryBtnClass}>{t("showSlots")}</button>
      </form>
    );

    body = (
      <div className="flex flex-col gap-8 sm:flex-row-reverse sm:items-start">
        <div className="border border-ink-line bg-ink-surface p-4 sm:w-64 sm:flex-none">
          {dateFilter}
        </div>
        <div className="flex-1">{results}</div>
      </div>
    );
  } else {
    step = 4;
    // step 4: confirm — reschedule needs no identity; new bookings need OTP
    const back = keep({});
    const when = format.dateTime(new Date(q.startsAt), {
      dateStyle: "medium", timeStyle: "short", timeZone: clinic.timezone });
    const summary = (
      <div className="mb-5 border border-ink-line bg-ink-surface p-5">
        <div className="text-sm text-muted">{sName(service)}</div>
        <div className="mt-1 font-display text-3xl font-bold tracking-tight">{when}</div>
      </div>
    );
    if (q.reschedule) {
      body = (
        <div>
          {summary}
          <form action={rescheduleAction}>
            <input type="hidden" name="reschedule" value={q.reschedule} />
            <input type="hidden" name="startsAt" value={q.startsAt} />
            <input type="hidden" name="back" value={back} />
            <button className={primaryBtnClass}>
              {t("confirmReschedule")}
            </button>
          </form>
        </div>
      );
    } else if (isPatient || q.sent) {
      body = (
        <div>
          {summary}
          <form action={confirmAction} className="flex max-w-xs flex-col gap-3">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="membershipId" value={q.membershipId} />
            <input type="hidden" name="startsAt" value={q.startsAt} />
            <input type="hidden" name="back" value={back} />
            {!isPatient && (
              <>
                <input type="hidden" name="phone" value={q.phone ?? ""} />
                <input type="hidden" name="name" value={q.name ?? ""} />
                <p className="text-sm text-muted">{t("codeSentTo", { phone: q.phone ?? "" })}</p>
                <input name="code" required maxLength={6} placeholder={t("code")}
                       className={`${inputClass} text-center tracking-[0.3em]`} />
              </>
            )}
            <button className={primaryBtnClass}>{t("confirm")}</button>
          </form>
        </div>
      );
    } else {
      body = (
        <div>
          {summary}
          <form action={requestOtpAction} className="flex max-w-xs flex-col gap-3">
            <input type="hidden" name="back" value={back} />
            <input name="name" required placeholder={t("yourName")} className={inputClass} />
            <input name="phone" type="tel" required placeholder={t("yourPhone")} className={inputClass} />
            <button className={primaryBtnClass}>{t("sendCode")}</button>
          </form>
        </div>
      );
    }
  }

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1.5 flex-1 ${n <= step ? "bg-accent" : "bg-ink-line"}`}
            />
          ))}
        </div>
        <h1 className="mt-7 font-display text-4xl font-bold tracking-tight">
          {q.reschedule ? t("rescheduleTitle") : t("title")}
        </h1>
        <p className="mt-1.5 mb-8 text-muted">{clinic.name}</p>
        {q.error && (
          <p className="mb-5 border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">
            {t(`errors.${q.error}` as never)}
          </p>
        )}
        {body}
      </Container>
    </div>
  );
}
