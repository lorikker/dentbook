import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isFavorited, toggleFavorite } from "@/lib/favorites";
import { withDbContext } from "@/lib/tenant-db";
import { Container } from "@/components/Container";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export default async function ClinicProfilePage({
  params,
}: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  const t = await getTranslations("Clinics");
  const clinic = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findFirst({
      where: { slug, published: true },
      include: {
        services: { where: { active: true }, orderBy: { nameSq: "asc" } },
        memberships: { where: { role: "DENTIST" },
                       include: { user: true }, orderBy: { createdAt: "asc" } },
        reviews: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" } },
      },
    }));
  if (!clinic) notFound();
  const about = locale === "en" ? clinic.aboutEn : clinic.aboutSq;
  const clinicId = clinic.id;

  const reviewCount = clinic.reviews.length;
  const avgRating = reviewCount
    ? clinic.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : null;
  const minPrice = clinic.services.length
    ? Math.min(...clinic.services.map((s) => Number(s.priceEur)))
    : null;

  const session = await auth();
  const favorited = session?.user?.id
    ? await isFavorited({ userId: session.user.id }, clinicId)
    : false;

  async function toggleFavoriteAction() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) return;
    // Deliberately not branching on the `favorited` computed above: that value
    // is from when the page rendered, and a stale tab would take the wrong
    // branch and 500. toggleFavorite decides from the current row instead.
    await toggleFavorite({ userId: s.user.id }, clinicId);
    revalidatePath(`/clinics/${slug}`);
  }

  return (
    <div className="bg-ink text-cream">
      <Container className="py-16">
        <Link href="/clinics" className="text-sm text-muted transition-colors hover:text-cream">
          ← {t("title")}
        </Link>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-6 border-b border-ink-line pb-7">
          <div className="flex gap-5">
            <div className="grid h-20 w-20 shrink-0 place-items-center bg-ink-surface text-2xl font-bold text-accent">
              {initialsOf(clinic.name)}
            </div>
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">{clinic.name}</h1>
              <p className="mt-2 text-muted">
                {clinic.city} · {clinic.address}
              </p>
              <p className="mt-1 text-muted">{clinic.phone}</p>
              <p className="mt-2 text-sm text-muted">
                {avgRating !== null
                  ? `${avgRating.toFixed(1)} ★ (${reviewCount} ${t("reviews")})`
                  : t("new")}
              </p>
            </div>
          </div>

          {session?.user?.id && (
            <form action={toggleFavoriteAction}>
              <button
                className="flex items-center gap-2 border border-ink-line px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover"
              >
                <span className={favorited ? "text-coral" : "text-muted-2"} aria-hidden="true">♥</span>
                {favorited ? t("removeFavorite") : t("addFavorite")}
              </button>
            </form>
          )}
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            {about && (
              <p className="mb-10 max-w-2xl whitespace-pre-line text-muted">{about}</p>
            )}

            <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
              {t("dentists").toUpperCase()}
            </h2>
            <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
              {clinic.memberships.map((m) => (
                <div key={m.id} className="border border-ink-line bg-ink-surface p-4">
                  <p className="font-semibold">
                    {m.user?.name}
                    {m.title ? ` · ${m.title}` : ""}
                  </p>
                  {m.bio && <p className="mt-1 text-sm text-muted">{m.bio}</p>}
                </div>
              ))}
            </div>

            <h2 className="mt-10 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
              {t("services").toUpperCase()}
            </h2>
            <div className="mt-3.5 border border-ink-line">
              {clinic.services.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-line bg-ink-surface px-5 py-4 last:border-b-0"
                >
                  <span>{locale === "en" ? s.nameEn : s.nameSq}</span>
                  <span className="flex items-center gap-5">
                    <span className="text-sm text-muted">{s.durationMin} min</span>
                    <span className="text-lg font-bold">{String(s.priceEur)} €</span>
                    <Link
                      href={`/clinics/${clinic.slug}/book?serviceId=${s.id}`}
                      className="bg-accent px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-accent-hover"
                    >
                      {t("book")}
                    </Link>
                  </span>
                </div>
              ))}
            </div>

            {clinic.reviews.length > 0 && (
              <>
                <h2 className="mt-10 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
                  {t("reviews").toUpperCase()}
                </h2>
                <div className="mt-3.5 grid gap-2.5">
                  {clinic.reviews.map((r) => (
                    <div key={r.id} className="border border-ink-line bg-ink-surface p-4">
                      <div className="text-accent">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                      {r.comment && <p className="mt-2 text-sm text-muted">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <aside className="border border-ink-line bg-ink-surface p-5 lg:sticky lg:top-22">
            {minPrice !== null && (
              <>
                <div className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
                  {t("from").toUpperCase()}
                </div>
                <div className="mt-1 font-display text-4xl font-bold tracking-tight">
                  {minPrice}€
                </div>
              </>
            )}
            {clinic.services[0] && (
              <Link
                href={`/clinics/${clinic.slug}/book?serviceId=${clinic.services[0].id}`}
                className="mt-4 block w-full bg-accent px-4 py-3.5 text-center text-base font-bold text-ink transition-colors hover:bg-accent-hover"
              >
                {t("book")}
              </Link>
            )}
            <div className="mt-5 grid gap-2.5 border-t border-ink-line pt-5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-2">{clinic.city}</span>
                <span>{clinic.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-2">{clinic.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-2">{t("dentists")}</span>
                <span>{clinic.memberships.length}</span>
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </div>
  );
}
