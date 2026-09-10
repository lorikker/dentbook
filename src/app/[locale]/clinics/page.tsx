import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  DIRECTORY_SORTS,
  listDirectoryClinics,
  type DirectorySort,
} from "@/lib/clinic-directory";
import { Container } from "@/components/Container";
import { SectionKicker } from "@/components/SectionKicker";
import { FilterChip } from "@/components/FilterChip";

type SortKey = DirectorySort;
const SORT_KEYS = DIRECTORY_SORTS;
const PRICE_PRESETS = [20, 30, 40];

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

function buildHref(
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  const merged = { ...base, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/clinics?${s}` : "/clinics";
}

export default async function ClinicsPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; q?: string; sort?: string; maxPrice?: string }>;
}) {
  const t = await getTranslations("Clinics");
  const { city, q, sort, maxPrice } = await searchParams;
  const sortKey: SortKey = SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : "name";
  const params = { city, q, sort, maxPrice };

  const { cities, clinics: decorated } = await listDirectoryClinics({
    city,
    q,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    sort: sortKey,
  });


  return (
    <div className="bg-ink text-cream">
      <Container className="py-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <SectionKicker>{t("kicker")}</SectionKicker>
            <h1 className="mt-3 font-display text-5xl font-bold tracking-tight">{t("title")}</h1>
          </div>
          <div className="text-sm text-muted">
            {decorated.length === 1 ? t("resultsOne") : t("resultsMany", { count: decorated.length })}
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[260px_1fr] lg:items-start">
          <aside className="border border-ink-line bg-ink-surface p-4.5 lg:sticky lg:top-22">
            <form action="/clinics" method="get" className="flex gap-2">
              {city && <input type="hidden" name="city" value={city} />}
              {sort && <input type="hidden" name="sort" value={sort} />}
              {maxPrice && <input type="hidden" name="maxPrice" value={maxPrice} />}
              <input
                type="text"
                name="q"
                defaultValue={q ?? ""}
                placeholder={t("searchPlaceholder")}
                className="w-full border border-ink-line bg-ink px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted-2 focus:border-accent"
              />
            </form>

            <div className="mt-5.5 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
              {t("allCities").toUpperCase()}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <FilterChip href={buildHref(params, { city: undefined })} active={!city}>
                {t("allCities")}
              </FilterChip>
              {cities.map((c) => (
                <FilterChip key={c} href={buildHref(params, { city: c })} active={city === c}>
                  {c}
                </FilterChip>
              ))}
            </div>

            <div className="mt-5.5 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
              {t("sortBy").toUpperCase()}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {SORT_KEYS.map((s) => (
                <FilterChip key={s} href={buildHref(params, { sort: s === "name" ? undefined : s })} active={sortKey === s}>
                  {t(`sort.${s}`)}
                </FilterChip>
              ))}
            </div>

            <div className="mt-5.5 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
              {t("maxPrice")}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <FilterChip href={buildHref(params, { maxPrice: undefined })} active={!maxPrice}>
                {t("priceAny")}
              </FilterChip>
              {PRICE_PRESETS.map((p) => (
                <FilterChip key={p} href={buildHref(params, { maxPrice: String(p) })} active={maxPrice === String(p)}>
                  {t("priceUnder", { amount: p })}
                </FilterChip>
              ))}
            </div>

            <Link
              href="/clinics"
              className="mt-6 block border border-ink-line px-3 py-2.5 text-center text-sm font-semibold text-muted-2 transition-colors hover:border-ink-line-hover hover:text-cream"
            >
              {t("resetFilters")}
            </Link>
          </aside>

          <div>
            {decorated.length === 0 ? (
              <div className="border border-ink-line bg-ink-surface p-14 text-center">
                <div className="text-xl font-semibold">{t("empty")}</div>
                <Link
                  href="/clinics"
                  className="mt-5 inline-block bg-accent px-5 py-3 text-sm font-bold text-ink transition-colors hover:bg-accent-hover"
                >
                  {t("resetFilters")}
                </Link>
              </div>
            ) : (
              <div className="grid gap-3">
                {decorated.map((c) => (
                  <Link
                    key={c.id}
                    href={`/clinics/${c.slug}`}
                    className="grid grid-cols-[54px_1fr_auto] items-center gap-4.5 border border-ink-line bg-ink-surface p-5 transition-colors hover:border-ink-line-hover"
                  >
                    <div className="grid h-13.5 w-13.5 place-items-center bg-ink text-lg font-bold text-accent">
                      {initialsOf(c.name)}
                    </div>
                    <div>
                      <div className="text-lg font-semibold tracking-tight">{c.name}</div>
                      <div className="mt-0.5 text-sm text-muted">
                        {c.city} · {c.address}
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {c.avgRating !== null
                          ? `${c.avgRating.toFixed(1)} ★ (${c.reviewCount} ${t("reviews")})`
                          : t("new")}
                      </div>
                    </div>
                    <div className="text-right">
                      {c.price !== null && (
                        <>
                          <div className="text-[11.5px] font-semibold tracking-[0.1em] text-muted-2">
                            {t("from").toUpperCase()}
                          </div>
                          <div className="font-display text-2xl font-bold tracking-tight">
                            {c.price}€
                          </div>
                        </>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </Container>
    </div>
  );
}
