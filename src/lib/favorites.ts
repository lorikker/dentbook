import { withDbContext } from "./tenant-db";

export class FavoriteError extends Error {
  constructor(public code: "ALREADY_FAVORITED") { super(code); }
}

export async function addFavorite(ctx: { userId: string }, clinicId: string) {
  return withDbContext({ role: "patient", userId: ctx.userId }, async (tx) => {
    const existing = await tx.favorite.findUnique({
      where: { userId_clinicId: { userId: ctx.userId, clinicId } },
    });
    if (existing) throw new FavoriteError("ALREADY_FAVORITED");
    return tx.favorite.create({ data: { userId: ctx.userId, clinicId } });
  });
}

export async function removeFavorite(ctx: { userId: string }, clinicId: string) {
  await withDbContext({ role: "patient", userId: ctx.userId }, (tx) =>
    tx.favorite.deleteMany({ where: { userId: ctx.userId, clinicId } }));
}

export async function listFavoriteClinics(ctx: { userId: string }) {
  const favorites = await withDbContext({ role: "patient", userId: ctx.userId }, (tx) =>
    tx.favorite.findMany({
      where: { userId: ctx.userId },
      include: { clinic: true },
      orderBy: { createdAt: "desc" },
    }));
  return favorites.map((f) => f.clinic);
}

/**
 * Flips the favourite state, reporting where it landed.
 *
 * The read and the write share one transaction, so a caller can't act on a
 * state that has already changed underneath it: the clinic page used to
 * branch on the `favorited` value captured when the page rendered, which
 * turned a stale tab into an ALREADY_FAVORITED throw (an unhandled 500)
 * instead of a no-op. The unique index on (userId, clinicId) is still the
 * final arbiter if two toggles race.
 */
export async function toggleFavorite(
  ctx: { userId: string },
  clinicId: string,
): Promise<{ favorited: boolean }> {
  return withDbContext({ role: "patient", userId: ctx.userId }, async (tx) => {
    const existing = await tx.favorite.findUnique({
      where: { userId_clinicId: { userId: ctx.userId, clinicId } },
    });
    if (existing) {
      await tx.favorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await tx.favorite.create({ data: { userId: ctx.userId, clinicId } });
    return { favorited: true };
  });
}

export async function countFavorites(ctx: { userId: string }): Promise<number> {
  return withDbContext({ role: "patient", userId: ctx.userId }, (tx) =>
    tx.favorite.count({ where: { userId: ctx.userId } }));
}

export async function isFavorited(ctx: { userId: string }, clinicId: string) {
  const existing = await withDbContext({ role: "patient", userId: ctx.userId }, (tx) =>
    tx.favorite.findUnique({
      where: { userId_clinicId: { userId: ctx.userId, clinicId } },
    }));
  return existing !== null;
}
