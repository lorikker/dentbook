import { withDbContext } from "./tenant-db";

/** Upserts a User by email for OAuth sign-ins (Google/Facebook). No adapter is
 * configured, so NextAuth doesn't persist users itself — we do it here. */
export async function upsertOAuthUser(email: string, name: string) {
  return withDbContext({ role: "auth" }, async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) return existing;
    return tx.user.create({ data: { email, name } });
  });
}
