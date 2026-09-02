import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class ProfileError extends Error {
  constructor(public code: "INVALID_INPUT") { super(code); }
}

const schema = z.object({
  name: z.string().min(1),
  email: z.email().optional(),
  locale: z.enum(["sq", "en"]),
});

export async function updateProfile(ctx: { userId: string }, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProfileError("INVALID_INPUT");
  return withDbContext({ role: "auth", userId: ctx.userId }, (tx) =>
    tx.user.update({ where: { id: ctx.userId }, data: parsed.data }));
}
