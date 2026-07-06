import { describe, it, expect } from "vitest";
import { computeSlots, wallTimeToUtc } from "@/lib/slots";

const TZ = "Europe/Belgrade";
const weekly = [{ weekday: 5, startMin: 540, endMin: 1020 }]; // Fri 09:00–17:00

describe("wallTimeToUtc", () => {
  it("converts winter wall time (CET, +1)", () => {
    expect(wallTimeToUtc("2026-01-16", 540, TZ).toISOString())
      .toBe("2026-01-16T08:00:00.000Z");
  });
  it("converts summer wall time (CEST, +2)", () => {
    expect(wallTimeToUtc("2026-07-17", 540, TZ).toISOString())
      .toBe("2026-07-17T07:00:00.000Z");
  });
});

describe("computeSlots", () => {
  it("generates stepped slots inside the window", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 30, stepMin: 30 });
    expect(slots.length).toBe(16); // 09:00..16:30
    expect(slots[0].startsAt.toISOString()).toBe("2026-07-17T07:00:00.000Z");
    expect(slots.at(-1)!.startsAt.toISOString()).toBe("2026-07-17T14:30:00.000Z");
  });
  it("returns nothing on days without schedule", () => {
    expect(computeSlots({
      dateISO: "2026-07-18", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 30 })).toEqual([]);
  });
  it("removes slots overlapping busy intervals", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [{ startsAt: new Date("2026-07-17T08:00:00Z"),
               endsAt: new Date("2026-07-17T09:00:00Z") }], // 10:00–11:00 wall
      durationMin: 30, stepMin: 30 });
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).not.toContain("2026-07-17T08:00:00.000Z");
    expect(starts).not.toContain("2026-07-17T08:30:00.000Z");
    expect(starts).toContain("2026-07-17T07:30:00.000Z");
    expect(starts).toContain("2026-07-17T09:00:00.000Z");
  });
  it("a slot must FIT inside the window (no 16:45 start for 30min)", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 45, stepMin: 30 });
    expect(slots.at(-1)!.endsAt.toISOString() <= "2026-07-17T15:00:00.000Z").toBe(true);
  });
  it("closed exception wins over weekly", () => {
    expect(computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly,
      exceptions: [{ date: "2026-07-17", closed: true }],
      busy: [], durationMin: 30 })).toEqual([]);
  });
  it("altered-hours exception replaces the weekly window", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly,
      exceptions: [{ date: "2026-07-17", closed: false, startMin: 600, endMin: 720 }],
      busy: [], durationMin: 30, stepMin: 30 });
    expect(slots.length).toBe(4); // 10:00, 10:30, 11:00, 11:30
  });
  it("hides slots before notBefore", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 30, stepMin: 30,
      notBefore: new Date("2026-07-17T12:00:00Z") }); // 14:00 wall
    expect(slots[0].startsAt.toISOString()).toBe("2026-07-17T12:00:00.000Z");
  });
});
