import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";

export type AppRole = "public" | "patient" | "staff" | "admin" | "auth";

export interface DbContext {
  role: AppRole;
  userId?: string;
  clinicId?: string;
}

/**
 * Runs `fn` in a transaction whose RLS session variables are set from `ctx`.
 * ALL request-path database access must go through this.
 */
export async function withDbContext<T>(
  ctx: DbContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.role', ${ctx.role}, true),
             set_config('app.user_id', ${ctx.userId ?? ""}, true),
             set_config('app.clinic_id', ${ctx.clinicId ?? ""}, true)
    `;
    return fn(tx);
  });
}
