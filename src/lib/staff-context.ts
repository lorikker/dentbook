import { withDbContext } from "./tenant-db";
import type { MembershipRole } from "@/generated/prisma/client";

export interface StaffContext {
  userId: string;
  clinicId: string;
  membershipId: string;
  role: MembershipRole;
}

/** First membership wins; multi-clinic switching is out of scope for v1. */
export async function resolveStaffMembership(userId: string) {
  return withDbContext({ role: "auth", userId }, async (tx) => {
    const m = await tx.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return m ? { clinicId: m.clinicId, membershipId: m.id, role: m.role } : null;
  });
}

/**
 * For server components/actions: redirects to login when not staff.
 * next-auth and next/navigation are imported lazily so this module can be
 * loaded by vitest (next-auth's deep `next/server` import breaks node ESM).
 */
export async function requireStaff(): Promise<StaffContext> {
  const [{ auth }, { redirect }] = await Promise.all([
    import("@/auth"),
    import("next/navigation"),
  ]);
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const m = await resolveStaffMembership(session.user.id);
  if (!m) redirect("/login");
  return { userId: session.user.id, ...m };
}
