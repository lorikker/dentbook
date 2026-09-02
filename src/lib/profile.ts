import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class ProfileError extends Error {
  constructor(public code: "INVALID_INPUT" | "EMAIL_TAKEN") { super(code); }
}

const schema = z.object({
  name: z.string().min(1),
  email: z.email().optional(),
  locale: z.enum(["sq", "en"]),
});

export async function updateProfile(ctx: { userId: string }, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProfileError("INVALID_INPUT");
  try {
    // role: "patient" (not "auth") — this only ever touches the caller's own
    // row via the WHERE clause, so the least-privileged self-scoped role
    // suffices; "auth" can reach any user row under the users RLS policy.
    return await withDbContext({ role: "patient", userId: ctx.userId }, (tx) =>
      tx.user.update({ where: { id: ctx.userId }, data: parsed.data }));
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      throw new ProfileError("EMAIL_TAKEN");
    }
    throw e;
  }
}
