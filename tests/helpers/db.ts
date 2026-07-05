import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

function makeClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Superuser client for arranging fixtures (bypasses RLS). */
export const direct = makeClient(process.env.TEST_DIRECT_DATABASE_URL!);

/** RLS-enforced client (dentbook_app role) — the system under test. */
export const app = makeClient(process.env.TEST_DATABASE_URL!);

export type AppRole = "public" | "patient" | "staff" | "admin" | "auth";

/** Test twin of withDbContext, bound to the test app client. */
export async function asContext<T>(
  ctx: { role: AppRole; userId?: string; clinicId?: string },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.role', ${ctx.role}, true),
             set_config('app.user_id', ${ctx.userId ?? ""}, true),
             set_config('app.clinic_id', ${ctx.clinicId ?? ""}, true)
    `;
    return fn(tx);
  });
}

/** Wipes all data between test files. */
export async function truncateAll() {
  await direct.$executeRawUnsafe(`
    TRUNCATE TABLE notifications, otp_codes, invoices, subscriptions, payments,
      reviews, appointments, schedule_exceptions, schedules, dentist_services,
      services, memberships, clinics, users CASCADE
  `);
}
