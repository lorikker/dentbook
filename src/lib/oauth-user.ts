import { withDbContext } from "./tenant-db";

/**
 * An OAuth email must not silently take over an existing password account —
 * otherwise anyone who controls that mailbox with an IdP could sign in as
 * that user (including a platform admin) with no password. Only new emails,
 * or emails on passwordless (patient-OTP) rows, may link.
 */
export async function isEmailLinkableForOAuth(email: string): Promise<boolean> {
  const existing = await withDbContext({ role: "auth" }, (tx) =>
    tx.user.findUnique({ where: { email } }));
  return !existing || !existing.passwordHash;
}

/** Upserts a User by email for OAuth sign-ins (Google/Facebook). No adapter is
 * configured, so NextAuth doesn't persist users itself — we do it here.
 * Callers must check `isEmailLinkableForOAuth` first (e.g. in the `signIn`
 * callback) so this never silently attaches to a password account. */
export async function upsertOAuthUser(email: string, name: string) {
  return withDbContext({ role: "auth" }, async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) return existing;
    return tx.user.create({ data: { email, name } });
  });
}
