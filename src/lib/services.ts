import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class ServiceError extends Error {
  constructor(public code: "INVALID_INPUT" | "NOT_FOUND") { super(code); }
}

const base = z.object({
  nameSq: z.string().min(2),
  nameEn: z.string().min(2),
  durationMin: z.number().int().min(5).max(480),
  priceEur: z.number().min(0).max(10000),
  depositEur: z.number().min(0).max(10000).nullish(),
  active: z.boolean().optional(),
});

type StaffCtx = { userId: string; clinicId: string };
const ctxOf = (c: StaffCtx) =>
  ({ role: "staff" as const, userId: c.userId, clinicId: c.clinicId });

export async function listServices(ctx: StaffCtx) {
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.service.findMany({ where: { clinicId: ctx.clinicId }, orderBy: { nameSq: "asc" } }));
}

export async function createService(ctx: StaffCtx, input: unknown) {
  const parsed = base.safeParse(input);
  if (!parsed.success) throw new ServiceError("INVALID_INPUT");
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.service.create({ data: { ...parsed.data, clinicId: ctx.clinicId } }));
}

export async function deleteService(ctx: StaffCtx, id: string): Promise<void> {
  await withDbContext(ctxOf(ctx), async (tx) => {
    const result = await tx.service.deleteMany({ where: { id, clinicId: ctx.clinicId } });
    if (result.count === 0) throw new ServiceError("NOT_FOUND");
  });
}

export async function updateService(ctx: StaffCtx, id: string, input: unknown) {
  const parsed = base.partial().safeParse(input);
  if (!parsed.success) throw new ServiceError("INVALID_INPUT");
  const res = await withDbContext(ctxOf(ctx), (tx) =>
    tx.service.updateMany({ where: { id }, data: parsed.data }));
  if (res.count === 0) throw new ServiceError("NOT_FOUND"); // RLS filtered it out
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.service.findUniqueOrThrow({ where: { id } }));
}
