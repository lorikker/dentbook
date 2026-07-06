export interface WeeklyEntry { weekday: number; startMin: number; endMin: number }
export interface ExceptionEntry {
  date: string; closed: boolean; startMin?: number | null; endMin?: number | null;
}
export interface BusyInterval { startsAt: Date; endsAt: Date }
export interface Slot { startsAt: Date; endsAt: Date }

export interface ComputeSlotsInput {
  dateISO: string;       // YYYY-MM-DD, clinic-local calendar day
  timezone: string;      // IANA tz of the clinic
  weekly: WeeklyEntry[];
  exceptions: ExceptionEntry[];
  busy: BusyInterval[];
  durationMin: number;
  stepMin?: number;
  notBefore?: Date;
}

/** Offset (ms) of `instant` in `tz`: wall-clock reading minus the instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"),
                             get("hour"), get("minute"), get("second"));
  return wallAsUtc - instant.getTime();
}

/** Converts a clinic-local wall time (date + minutes) to a UTC instant. */
export function wallTimeToUtc(dateISO: string, minutes: number, tz: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // two-pass: estimate offset at the naive instant, then re-check at the result
  let result = naive - tzOffsetMs(new Date(naive), tz);
  result = naive - tzOffsetMs(new Date(result), tz);
  return new Date(result);
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const step = input.stepMin ?? 15;
  const [y, m, d] = input.dateISO.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  const exception = input.exceptions.find((e) => e.date === input.dateISO);
  let windows: { startMin: number; endMin: number }[];
  if (exception) {
    windows = exception.closed
      ? []
      : [{ startMin: exception.startMin!, endMin: exception.endMin! }];
  } else {
    windows = input.weekly.filter((w) => w.weekday === weekday);
  }

  const slots: Slot[] = [];
  for (const w of windows) {
    for (let t = w.startMin; t + input.durationMin <= w.endMin; t += step) {
      const startsAt = wallTimeToUtc(input.dateISO, t, input.timezone);
      const endsAt = wallTimeToUtc(input.dateISO, t + input.durationMin, input.timezone);
      if (input.notBefore && startsAt < input.notBefore) continue;
      const overlapsBusy = input.busy.some(
        (b) => startsAt < b.endsAt && b.startsAt < endsAt);
      if (!overlapsBusy) slots.push({ startsAt, endsAt });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
