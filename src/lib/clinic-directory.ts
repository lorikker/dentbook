import { withDbContext } from "./tenant-db";

export type DirectorySort = "name" | "rating" | "price";
export const DIRECTORY_SORTS: DirectorySort[] = ["name", "rating", "price"];

export interface DirectoryQuery {
  city?: string;
  /** Free-text match against the clinic name, case-insensitive. */
  q?: string;
  /** Upper bound on a clinic's cheapest active service, in EUR. */
  maxPrice?: number;
  sort?: DirectorySort;
}

export interface DirectoryClinic {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  /** Cheapest active service, or null when the clinic lists none. */
  price: number | null;
  avgRating: number | null;
  reviewCount: number;
}

export interface DirectoryResult {
  /** Every city in the directory — not just the ones matching this query, so
   *  the filter chips stay stable as the user narrows the results. */
  cities: string[];
  clinics: DirectoryClinic[];
}

/**
 * Backs the /clinics directory.
 *
 * Filtering happens in Postgres. The previous version loaded every published
 * clinic together with every one of its published reviews on each request and
 * narrowed the set in JavaScript, so a directory of a few hundred clinics
 * shipped tens of thousands of review rows to render one page of cards.
 */
export async function listDirectoryClinics(
  query: DirectoryQuery,
): Promise<DirectoryResult> {
  const name = (query.q ?? "").trim();
  // Number("abc") is NaN; as a SQL bound that would silently match nothing,
  // so anything unparseable means "no price filter" (the old JS comparison
  // against NaN was likewise always false).
  const maxPrice = Number.isFinite(query.maxPrice) ? query.maxPrice : undefined;
  const sort = query.sort ?? "name";

  const where = {
    published: true,
    ...(query.city ? { city: query.city } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    // A clinic's shown price is its cheapest active service, so
    // "min(price) <= max" is exactly "some active service <= max". Clinics
    // with no active service have no price and stay listed, as before.
    ...(maxPrice !== undefined
      ? {
          OR: [
            { services: { none: { active: true } } },
            { services: { some: { active: true, priceEur: { lte: maxPrice } } } },
          ],
        }
      : {}),
  };

  // Separate contexts, not one transaction wrapping a Promise.all: a
  // transaction is pinned to a single connection, so queries inside it queue
  // rather than overlap. See withDbContext.
  const [cityGroups, matches] = await Promise.all([
    withDbContext({ role: "public" }, (tx) =>
      tx.clinic.groupBy({ by: ["city"], where: { published: true } })),
    withDbContext({ role: "public" }, (tx) =>
      tx.clinic.findMany({
        where,
        orderBy: { name: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          city: true,
          address: true,
          services: {
            where: { active: true },
            orderBy: { priceEur: "asc" },
            take: 1,
            select: { priceEur: true },
          },
        },
      })),
  ]);

  // Ratings aggregate in Postgres: one row per clinic rather than one per review.
  const ratings = matches.length
    ? await withDbContext({ role: "public" }, (tx) =>
        tx.review.groupBy({
          by: ["clinicId"],
          where: { clinicId: { in: matches.map((c) => c.id) }, status: "PUBLISHED" },
          _avg: { rating: true },
          _count: { _all: true },
        }))
    : [];
  const byClinic = new Map(ratings.map((r) => [r.clinicId, r]));

  const clinics: DirectoryClinic[] = matches.map((c) => {
    const agg = byClinic.get(c.id);
    const reviewCount = agg?._count._all ?? 0;
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      city: c.city,
      address: c.address,
      price: c.services[0] ? Number(c.services[0].priceEur) : null,
      avgRating: reviewCount ? agg!._avg.rating : null,
      reviewCount,
    };
  });

  // Rating and price order depend on the aggregate, so they're applied here
  // rather than in SQL; the row set is already narrowed by `where`.
  clinics.sort((a, b) => {
    if (sort === "rating") return (b.avgRating ?? -1) - (a.avgRating ?? -1);
    if (sort === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
    return a.name.localeCompare(b.name);
  });

  return { cities: cityGroups.map((g) => g.city).sort(), clinics };
}
