import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDirect?: PrismaClient;
};

function makeClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** RLS-enforced app connection (dentbook_app role). All request-path code uses this. */
export const prisma =
  globalForPrisma.prisma ?? makeClient(process.env.DATABASE_URL!);

/** Superuser connection. ONLY for seeds, tests, and ops tooling — bypasses RLS. */
export const prismaDirect =
  globalForPrisma.prismaDirect ?? makeClient(process.env.DIRECT_DATABASE_URL!);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDirect = prismaDirect;
}
