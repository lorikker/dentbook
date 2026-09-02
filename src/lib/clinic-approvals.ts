import { withDbContext } from "./tenant-db";

export async function listPendingClinics(ctx: { userId: string }) {
  return withDbContext({ role: "admin", userId: ctx.userId }, (tx) =>
    tx.clinic.findMany({ where: { published: false }, orderBy: { createdAt: "asc" } }));
}

export async function approveClinic(ctx: { userId: string }, clinicId: string) {
  return withDbContext({ role: "admin", userId: ctx.userId }, (tx) =>
    tx.clinic.update({
      where: { id: clinicId },
      data: { published: true, approvedAt: new Date() },
    }));
}
