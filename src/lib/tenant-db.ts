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
 *
 * Await `tx` queries **sequentially** inside `fn` — never `Promise.all`.
 * The whole transaction is pinned to one pooled connection, and Postgres runs
 * one query at a time per connection, so concurrent `tx` calls gain nothing:
 * node-postgres just queues them (measured: two 400ms queries take ~850ms on
 * one connection vs ~460ms across two). It also trips a pg deprecation warning
 * that becomes a hard removal in pg@9.
 *
 * When queries genuinely should overlap, give each its own connection by
 * running separate `withDbContext` calls inside `Promise.all` — safe for
 * independent reads, since each gets its own transaction and RLS context.
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
