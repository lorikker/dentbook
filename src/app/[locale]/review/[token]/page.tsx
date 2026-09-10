import { notFound, redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { getReviewContext, submitReview, ReviewError } from "@/lib/reviews";
import { Container } from "@/components/Container";

export default async function ReviewPage({
  params, searchParams,
}: {
  params: Promise<{ token: string; locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token, locale } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("Review");
  const format = await getFormatter();
  const ctx = await getReviewContext(token);
  if (!ctx) notFound();
  const a = ctx.appointment;
  const serviceName = locale === "en" ? a.service.nameEn : a.service.nameSq;

  async function submitAction(formData: FormData) {
    "use server";
    try {
      await submitReview(token, {
        rating: formData.get("rating"), comment: formData.get("comment") ?? "" });
    } catch (e) {
      redirect(`/review/${token}?error=${e instanceof ReviewError ? e.code : "UNKNOWN"}`);
    }
    redirect(`/review/${token}`);
  }

  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        <div className="mt-6 border border-ink-line bg-ink-surface p-5">
          <p className="text-lg font-semibold">{a.clinic.name}</p>
          <p className="mt-1 text-sm text-muted">
            {serviceName} · {a.membership.user?.name}
          </p>
          <p className="mt-1 text-sm text-muted">
            {format.dateTime(a.startsAt, { dateStyle: "long", timeZone: a.clinic.timezone })}
          </p>
        </div>

        {error && (
          <p className="mt-5 border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">
            {t(`errors.${error}` as never)}
          </p>
        )}

        {ctx.review ? (
          <div className="mt-6 border border-accent/40 bg-accent/10 p-5">
            <p className="font-semibold text-accent">{t("thanks")}</p>
            <p className="mt-2 text-lg text-accent" aria-label={t("stars", { count: ctx.review.rating })}>
              {stars(ctx.review.rating)}
            </p>
            {ctx.review.comment && <p className="mt-2 text-sm text-muted">{ctx.review.comment}</p>}
          </div>
        ) : a.status !== "COMPLETED" ? (
          <p className="mt-6 text-muted">{t("notYet")}</p>
        ) : (
          <form action={submitAction} className="mt-6 flex flex-col gap-5">
            <fieldset>
              <legend className="text-sm font-semibold">{t("ratingLabel")}</legend>
              <div className="mt-2 flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="rating" value={n} required className="peer sr-only" />
                    <span
                      aria-label={t("stars", { count: n })}
                      className="grid h-12 w-12 place-items-center border border-ink-line bg-ink-surface text-lg transition-colors peer-checked:border-accent peer-checked:text-accent peer-focus-visible:border-accent"
                    >
                      {n}★
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-2 text-sm font-semibold">
              {t("commentLabel")}
              <textarea
                name="comment" rows={4} maxLength={1000} placeholder={t("commentPlaceholder")}
                className="border border-ink-line bg-ink px-3.5 py-3 font-normal text-cream outline-none placeholder:text-muted-2 focus:border-accent"
              />
            </label>
            <button className="self-start bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
              {t("submit")}
            </button>
          </form>
        )}
      </Container>
    </div>
  );
}
