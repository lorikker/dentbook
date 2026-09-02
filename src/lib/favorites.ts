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

export async function isFavorited(ctx: { userId: string }, clinicId: string) {
  const existing = await withDbContext({ role: "patient", userId: ctx.userId }, (tx) =>
    tx.favorite.findUnique({
      where: { userId_clinicId: { userId: ctx.userId, clinicId } },
    }));
  return existing !== null;
}
