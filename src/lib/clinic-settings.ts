import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class SettingsError extends Error {
  constructor(public code: "INVALID_INPUT") { super(code); }
}

const schema = z.object({
  name: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  address: z.string().min(2).optional(),
  phone: z.string().min(8).optional(),
  aboutSq: z.string().optional(),
  aboutEn: z.string().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bookingMode: z.enum(["INSTANT", "APPROVAL"]).optional(),
  cancellationWindowHours: z.number().int().min(0).max(168).optional(),
});

export async function updateClinicSettings(
  ctx: { userId: string; clinicId: string }, input: unknown,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new SettingsError("INVALID_INPUT");
  return withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.clinic.update({ where: { id: ctx.clinicId }, data: parsed.data }));
}
