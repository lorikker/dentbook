import { getTranslations, getFormatter } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin-context";
import { listPendingClinics, approveClinic } from "@/lib/clinic-approvals";
import { connectMongo } from "@/lib/mongo";
import { ActivityLog } from "@/lib/models/activity-log";
import { Testimonial } from "@/lib/models/testimonial";
import { Container } from "@/components/Container";
import { SectionKicker } from "@/components/SectionKicker";
import { StatTile } from "@/components/StatTile";
import { runScheduledJobs } from "@/lib/cron";
import { listReviewsForModeration, setReviewStatus } from "@/lib/reviews";
import { listSubscriptionsForAdmin, markInvoicePaid, setPlan, PLAN_PRICE_EUR } from "@/lib/billing";

interface ActivityLogEntry {
  _id: unknown;
  type: string;
  message: string;
  createdAt: Date;
}

interface TestimonialEntry {
  _id: unknown;
  authorName: string;
  quote: string;
  published: boolean;
}

export default async function AdminPage({
  searchParams,
}: { searchParams: Promise<{ ran?: string; ok?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const flags = await searchParams;

  const [pendingClinics] = await Promise.all([
    listPendingClinics(ctx),
    connectMongo(),
  ]);
  const [activityLogs, testimonials, reviews, subscriptions] = await Promise.all([
    ActivityLog.find().sort({ createdAt: -1 }).limit(50).lean<ActivityLogEntry[]>(),
    Testimonial.find().sort({ createdAt: -1 }).lean<TestimonialEntry[]>(),
    listReviewsForModeration(ctx),
    listSubscriptionsForAdmin(ctx),
  ]);

  const inputClass = "border border-ink-line bg-ink-surface px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted-2 focus:border-accent";

  async function approveAction(formData: FormData) {
    "use server";
    const c = await requirePlatformAdmin();
    await approveClinic(c, String(formData.get("clinicId")));
    revalidatePath("/admin");
  }

  async function toggleAction(formData: FormData) {
    "use server";
    await requirePlatformAdmin();
    const [{ connectMongo }, { Testimonial }] = await Promise.all([
      import("@/lib/mongo"),
      import("@/lib/models/testimonial"),
    ]);
    await connectMongo();
    const id = String(formData.get("id"));
    const currentPublished = formData.get("published") === "true";
    await Testimonial.findByIdAndUpdate(id, { published: !currentPublished });
    revalidatePath("/admin");
  }

  async function runJobsAction() {
    "use server";
    await requirePlatformAdmin();
    const summary = await runScheduledJobs();
    const results = Object.values(summary);
    const total = results.length;
    const ok = results.filter((r) => r.ok).length;
    redirect(`/admin?ran=${total}&ok=${ok}`);
  }

  async function toggleReviewAction(formData: FormData) {
    "use server";
    const c = await requirePlatformAdmin();
    const id = String(formData.get("id"));
    const next = formData.get("status") === "PUBLISHED" ? "HIDDEN" : "PUBLISHED";
    await setReviewStatus(c, id, next);
    revalidatePath("/admin");
  }

  async function markPaidAction(formData: FormData) {
    "use server";
    const c = await requirePlatformAdmin();
    await markInvoicePaid(c, String(formData.get("invoiceId")));
    revalidatePath("/admin");
  }

  async function setPlanAction(formData: FormData) {
    "use server";
    const c = await requirePlatformAdmin();
    const plan = String(formData.get("plan"));
    if (plan === "BASIC" || plan === "PRO") {
      await setPlan(c, String(formData.get("subscriptionId")), plan);
    }
    revalidatePath("/admin");
  }

  return (
    <div className="bg-ink text-cream">
      <Container className="py-16">
        <div className="flex items-center gap-3">
          <SectionKicker>ADMIN PANEL</SectionKicker>
          <span className="border border-coral/40 px-2 py-0.5 text-xs font-bold tracking-[0.08em] text-coral">
            RESTRICTED
          </span>
        </div>
        <h1 className="mt-3 font-display text-5xl font-bold tracking-tight">{t("title")}</h1>

        <div className="mt-10 grid grid-cols-1 gap-px border border-ink-line bg-ink-line sm:grid-cols-3">
          <div className="bg-ink-surface p-5">
            <StatTile value={String(pendingClinics.length)} label={t("pendingClinics").toUpperCase()} />
          </div>
          <div className="bg-ink-surface p-5">
            <StatTile value={String(activityLogs.length)} label={t("activityFeed").toUpperCase()} />
          </div>
          <div className="bg-ink-surface p-5">
            <StatTile value={String(testimonials.length)} label={t("testimonials").toUpperCase()} />
          </div>
        </div>

        <section className="mt-12">
          <form action={runJobsAction} className="flex flex-wrap items-center gap-4">
            <button className="bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">
              {t("runJobs")}
            </button>
            <p className="text-sm text-muted">{t("runJobsHint")}</p>
          </form>
          {flags.ran && (
            <p className="mt-3 text-sm text-cream">
              {t("jobsRan", { ok: Number(flags.ok ?? 0), total: Number(flags.ran) })}
            </p>
          )}
        </section>

        <section className="mt-12">
          <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
            {t("pendingClinics").toUpperCase()}
          </h2>
          {pendingClinics.length === 0 && (
            <p className="mt-3 text-muted">{t("noPending")}</p>
          )}
          <div className="mt-3.5 grid gap-2.5">
            {pendingClinics.map((clinic) => (
              <div key={clinic.id} className="flex flex-wrap items-center justify-between gap-4 border border-ink-line bg-ink-surface p-4">
                <div>
                  <p className="font-semibold">{clinic.name}</p>
                  <p className="mt-0.5 text-sm text-muted">{clinic.city} · {clinic.address}</p>
                </div>
                <form action={approveAction}>
                  <input type="hidden" name="clinicId" value={clinic.id} />
                  <button className="bg-accent px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">
                    {t("approve")}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
            {t("activityFeed").toUpperCase()}
          </h2>
          {activityLogs.length === 0 && (
            <p className="mt-3 text-muted">{t("noActivity")}</p>
          )}
          <div className="mt-3.5 border border-ink-line">
            {activityLogs.map((log) => (
              <div key={String(log._id)} className="border-b border-ink-line bg-ink-surface px-4 py-3 text-sm last:border-b-0">
                <span className="font-mono text-xs text-muted-2">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
                {" — "}
                <span className="font-semibold">{log.type}</span>
                {": "}
                <span className="text-muted">{log.message}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
            {t("testimonials").toUpperCase()}
          </h2>
          {testimonials.length === 0 && (
            <p className="mt-3 text-muted">{t("noTestimonials")}</p>
          )}
          <div className="mt-3.5 grid gap-2.5">
            {testimonials.map((testimonial) => (
              <div key={String(testimonial._id)} className="flex flex-wrap items-center justify-between gap-4 border border-ink-line bg-ink-surface p-4">
                <div>
                  <p className="font-semibold">{testimonial.authorName}</p>
                  <p className="mt-0.5 text-sm text-muted">{testimonial.quote}</p>
                </div>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={String(testimonial._id)} />
                  <input type="hidden" name="published" value={String(testimonial.published)} />
                  <button className="border border-ink-line px-4 py-2 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                    {testimonial.published ? t("hide") : t("publish")}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
            {t("reviews").toUpperCase()}
          </h2>
          {reviews.length === 0 && (
            <p className="mt-3 text-muted">{t("noReviews")}</p>
          )}
          <div className="mt-3.5 grid gap-2.5">
            {reviews.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 border border-ink-line bg-ink-surface p-4">
                <div>
                  <p className="font-semibold">
                    {r.clinic.name}
                    <span className="ml-2 text-accent">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                    {r.status === "HIDDEN" && (
                      <span className="ml-2 border border-coral/40 px-2 py-0.5 text-xs font-bold tracking-[0.06em] text-coral">
                        {t("hidden").toUpperCase()}
                      </span>
                    )}
                  </p>
                  {r.comment && <p className="mt-0.5 text-sm text-muted">{r.comment}</p>}
                  <p className="mt-0.5 text-xs text-muted-2">
                    {format.dateTime(r.createdAt, { dateStyle: "medium" })}
                  </p>
                </div>
                <form action={toggleReviewAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value={r.status} />
                  <button className="border border-ink-line px-4 py-2 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                    {r.status === "PUBLISHED" ? t("hide") : t("publish")}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
            {t("subscriptions").toUpperCase()}
          </h2>
          <div className="mt-3.5 grid gap-2.5">
            {subscriptions.map((sub) => (
              <div key={sub.id} className="border border-ink-line bg-ink-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold">{sub.clinic.name}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {sub.plan}
                      {" · "}
                      <span className={sub.status === "PAST_DUE" ? "font-semibold text-coral" : ""}>
                        {sub.status}
                      </span>
                      {sub.plan === "TRIAL" && sub.trialEndsAt && (
                        <> · {t("trialEnds")}: {format.dateTime(sub.trialEndsAt, { dateStyle: "medium" })}</>
                      )}
                      {sub.plan !== "TRIAL" && sub.currentPeriodEnd && (
                        <> · {t("periodEnd")}: {format.dateTime(sub.currentPeriodEnd, { dateStyle: "medium" })}</>
                      )}
                    </p>
                  </div>
                  <form action={setPlanAction} className="flex items-center gap-2">
                    <input type="hidden" name="subscriptionId" value={sub.id} />
                    <select name="plan" defaultValue={sub.plan === "PRO" ? "PRO" : "BASIC"} className={inputClass}>
                      <option value="BASIC">BASIC — {PLAN_PRICE_EUR.BASIC} €</option>
                      <option value="PRO">PRO — {PLAN_PRICE_EUR.PRO} €</option>
                    </select>
                    <button className="border border-ink-line px-3.5 py-2 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                      {t("setPlan")}
                    </button>
                  </form>
                </div>
                {sub.invoices.length > 0 && (
                  <div className="mt-3 border-t border-ink-line">
                    {sub.invoices.map((inv) => (
                      <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-line py-2 text-sm last:border-b-0">
                        <span className="text-muted">
                          {format.dateTime(inv.periodStart, { dateStyle: "medium" })}
                          {" – "}
                          {format.dateTime(inv.periodEnd, { dateStyle: "medium" })}
                          {" · "}
                          {format.number(Number(inv.amountEur), { style: "currency", currency: "EUR" })}
                        </span>
                        <form action={markPaidAction}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <button className="border border-ink-line px-3 py-1.5 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                            {t("markPaid")}
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </Container>
    </div>
  );
}
