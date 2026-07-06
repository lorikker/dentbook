import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class ScheduleError extends Error {
  constructor(public code: "INVALID_INPUT" | "OVERLAP" | "NOT_FOUND") { super(code); }
}

const entrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
});
export type WeeklyEntry = z.infer<typeof entrySchema>;

type StaffCtx = { userId: string; clinicId: string };
const ctxOf = (c: StaffCtx) =>
  ({ role: "staff" as const, userId: c.userId, clinicId: c.clinicId });

export async function setWeeklySchedule(
  ctx: StaffCtx, membershipId: string, entries: WeeklyEntry[],
) {
  const parsed = z.array(entrySchema).safeParse(entries);
  if (!parsed.success) throw new ScheduleError("INVALID_INPUT");
  for (const e of parsed.data) {
    if (e.startMin >= e.endMin) throw new ScheduleError("INVALID_INPUT");
  }
  // overlap check per weekday
  for (let d = 0; d <= 6; d++) {
    const day = parsed.data.filter((e) => e.weekday === d)
      .sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < day.length; i++) {
      if (day[i].startMin < day[i - 1].endMin) throw new ScheduleError("OVERLAP");
    }
  }
  return withDbContext(ctxOf(ctx), async (tx) => {
    // RLS guarantees membership belongs to this clinic (schedules_write policy)
    await tx.schedule.deleteMany({ where: { membershipId } });
    if (parsed.data.length > 0) {
      await tx.schedule.createMany({
        data: parsed.data.map((e) => ({ ...e, membershipId })) });
    }
  });
}

const exceptionSchema = z.object({
  membershipId: z.string().uuid().nullish(), // null = clinic-wide
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closed: z.boolean(),
  startMin: z.number().int().min(0).max(1439).nullish(),
  endMin: z.number().int().min(1).max(1440).nullish(),
}).refine((e) => e.closed || (e.startMin != null && e.endMin != null && e.startMin < e.endMin));

export async function addException(ctx: StaffCtx, input: unknown) {
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) throw new ScheduleError("INVALID_INPUT");
  const d = parsed.data;
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.scheduleException.create({
      data: { clinicId: ctx.clinicId, membershipId: d.membershipId ?? null,
              date: new Date(`${d.date}T00:00:00Z`), closed: d.closed,
              startMin: d.startMin ?? null, endMin: d.endMin ?? null } }));
}

export async function listSchedulesForClinic(ctx: StaffCtx) {
  return withDbContext(ctxOf(ctx), async (tx) => {
    const dentists = await tx.membership.findMany({
      where: { clinicId: ctx.clinicId, role: "DENTIST" },
      include: { user: true, schedules: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] } },
    });
    return dentists;
  });
}
