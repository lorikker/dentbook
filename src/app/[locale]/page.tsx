import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { withDbContext } from "@/lib/tenant-db";
import { Container } from "@/components/Container";
import { SectionKicker } from "@/components/SectionKicker";
import { StatTile } from "@/components/StatTile";
import { ToothChart } from "@/components/ToothChart";
import { HomeTestimonials } from "@/components/HomeTestimonials";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export default async function HomePage() {
  const t = await getTranslations("Home");

  // One withDbContext per query rather than one transaction wrapping a
  // Promise.all: a transaction is pinned to a single connection, so queries
  // inside it queue instead of overlapping. Separate contexts get separate
  // pooled connections and genuinely run in parallel. These are independent
  // public reads, so they need no shared snapshot.
  const [cityGroups, servicesCount, candidates] = await Promise.all([
    // Doubles as the clinic count — summing the per-city groups avoids a
    // second full scan just to COUNT(*).
    withDbContext({ role: "public" }, (tx) =>
      tx.clinic.groupBy({
        by: ["city"],
        where: { published: true },
        _count: { _all: true },
      })),
    withDbContext({ role: "public" }, (tx) =>
      tx.service.count({ where: { active: true, clinic: { published: true } } })),
    withDbContext({ role: "public" }, (tx) =>
      tx.clinic.findMany({
        where: { published: true },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          slug: true,
          name: true,
          city: true,
          services: {
            where: { active: true },
            orderBy: { priceEur: "asc" },
            take: 1,
            select: { priceEur: true },
          },
        },
      })),
  ]);

  const clinicsCount = cityGroups.reduce((n, g) => n + g._count._all, 0);
  const citiesCount = cityGroups.length;

  // Aggregate the ratings in Postgres instead of shipping every review row
  // back just to average it in JS: one row per clinic, not one per review.
  const ratings = candidates.length
    ? await withDbContext({ role: "public" }, (tx) =>
        tx.review.groupBy({
          by: ["clinicId"],
          where: { clinicId: { in: candidates.map((c) => c.id) }, status: "PUBLISHED" },
          _avg: { rating: true },
          _count: { _all: true },
        }))
    : [];
  const ratingByClinic = new Map(ratings.map((r) => [r.clinicId, r]));

  const decorated = candidates.map((c) => {
    const agg = ratingByClinic.get(c.id);
    const reviewCount = agg?._count._all ?? 0;
    const avgRating = reviewCount ? agg!._avg.rating : null;
    const priceLabel = c.services[0] ? String(c.services[0].priceEur) : null;
    return { ...c, reviewCount, avgRating, priceLabel };
  });
  decorated.sort((a, b) => {
    const ra = a.avgRating ?? -1;
    const rb = b.avgRating ?? -1;
    if (rb !== ra) return rb - ra;
    return b.reviewCount - a.reviewCount;
  });
  const featured = decorated.slice(0, 3);

  const steps = ["1", "2", "3"] as const;

  return (
    <div className="bg-ink text-cream">
      {/* ── Hero ── */}
      <Container className="grid items-start gap-16 pt-20 pb-16 lg:grid-cols-2">
        <div className="animate-db-up">
          <SectionKicker dot>{t("kicker")}</SectionKicker>
          <h1 className="mt-5 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">
            {t("title")}
            <br />
            <span className="text-accent">{t("titleAccent")}</span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted">{t("subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/clinics"
              className="flex items-center gap-2 bg-accent px-6 py-4 text-base font-bold text-ink transition-colors hover:bg-accent-hover"
            >
              {t("cta")} <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/register"
              className="border border-ink-line px-5 py-4 text-base font-semibold text-cream transition-colors hover:border-ink-line-hover"
            >
              {t("ctaSecondary")}
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-3 gap-8 border-t border-ink-line pt-6">
            <StatTile value={String(clinicsCount)} label={t("stats.clinics")} />
            <StatTile value={String(citiesCount)} label={t("stats.cities")} />
            <StatTile value={String(servicesCount)} label={t("stats.services")} />
          </div>
        </div>

        <div className="animate-db-up" style={{ animationDelay: "0.1s" }}>
          <ToothChart />
        </div>
      </Container>

      {/* ── How it works ── */}
      <div className="border-t border-ink-line">
        <Container className="py-20">
          <SectionKicker>{t("steps.kicker")}</SectionKicker>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            {t("steps.title")}
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map((n) => (
              <div key={n} className="border border-ink-line bg-ink-surface p-7">
                <div className="font-display text-5xl font-extrabold tracking-tight text-ink-line">
                  0{n}
                </div>
                <div className="mt-4 text-xl font-semibold tracking-tight">
                  {t(`steps.${n}.title`)}
                </div>
                <p className="mt-2.5 text-muted">{t(`steps.${n}.body`)}</p>
              </div>
            ))}
          </div>
        </Container>
      </div>

      {/* ── Featured clinics ── */}
      {featured.length > 0 && (
        <div className="border-t border-ink-line">
          <Container className="py-20">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <SectionKicker>{t("featured.kicker")}</SectionKicker>
                <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
                  {t("featured.title")}
                </h2>
              </div>
              <Link href="/clinics" className="text-sm font-semibold text-accent hover:text-accent-hover">
                {t("featured.viewAll")} →
              </Link>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {featured.map((c) => (
                <Link
                  key={c.id}
                  href={`/clinics/${c.slug}`}
                  className="block border border-ink-line bg-ink-surface p-5 transition-colors hover:border-ink-line-hover"
                >
                  <div className="grid h-11 w-11 place-items-center bg-ink text-sm font-bold text-accent">
                    {initialsOf(c.name)}
                  </div>
                  <div className="mt-4 text-lg font-semibold tracking-tight">{c.name}</div>
                  <div className="text-sm text-muted">{c.city}</div>
                  <div className="mt-3 text-sm text-muted">
                    {c.avgRating !== null
                      ? `${c.avgRating.toFixed(1)} ★ (${c.reviewCount} ${t("featured.reviews")})`
                      : t("featured.new")}
                  </div>
                  {c.priceLabel && (
                    <div className="text-sm text-muted">
                      {t("featured.from")} {c.priceLabel}€
                    </div>
                  )}
                  <div className="mt-4 border-t border-ink-line pt-3 text-sm font-semibold text-accent">
                    {t("featured.view")} →
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        </div>
      )}

      <HomeTestimonials />

      {/* ── For clinics CTA ── */}
      <div className="border-t border-ink-line bg-cream py-20 text-ink">
        <Container>
          <SectionKicker className="text-muted-2">{t("cta2.kicker")}</SectionKicker>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold tracking-tight sm:text-5xl">
            {t("cta2.title")}
          </h2>
          <p className="mt-5 max-w-lg text-lg text-muted-2">{t("cta2.body")}</p>
          <Link
            href="/register"
            className="mt-8 inline-flex items-center gap-2 bg-ink px-6 py-4 text-base font-bold text-cream transition-colors hover:bg-ink-surface"
          >
            {t("cta2.button")} <span aria-hidden="true">→</span>
          </Link>
        </Container>
      </div>
    </div>
  );
}
