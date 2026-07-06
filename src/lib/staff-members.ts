import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { hashPassword } from "./staff-auth";
import type { MembershipRole } from "@/generated/prisma/client";

export class StaffError extends Error {
  constructor(public code: "INVALID_INPUT" | "FORBIDDEN") { super(code); }
}

const schema = z.object({
  name: z.string().min(2),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(["DENTIST", "RECEPTIONIST", "OWNER"]),
  title: z.string().optional(),
  bio: z.string().optional(),
});

type StaffCtx = { userId: string; clinicId: string; role: MembershipRole };

export async function listStaff(ctx: StaffCtx) {
  return withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.membership.findMany({
      where: { clinicId: ctx.clinicId },
      include: { user: true }, orderBy: { createdAt: "asc" } }));
}

export async function addStaffMember(ctx: StaffCtx, input: unknown) {
  if (ctx.role !== "OWNER") throw new StaffError("FORBIDDEN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new StaffError("INVALID_INPUT");
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);
  // user lookup/creation needs the auth context; membership needs staff context
  return withDbContext(
    { role: "auth", userId: ctx.userId, clinicId: ctx.clinicId },
    async (tx) => {
      const user =
        (await tx.user.findUnique({ where: { email: d.email } })) ??
        (await tx.user.create({
          data: { name: d.name, email: d.email, passwordHash } }));
      return tx.membership.create({
        data: { userId: user.id, clinicId: ctx.clinicId, role: d.role,
                title: d.title, bio: d.bio } });
    });
}
