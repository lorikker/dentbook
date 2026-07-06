import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { setWeeklySchedule, addException, ScheduleError } from "@/lib/schedules";

let ctx: { userId: string; clinicId: string };
let dentistMembershipId: string;

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "sch-klinika", name: "S", city: "P", address: "x", phone: "x" } });
  const owner = await direct.user.create({
    data: { name: "O", email: "sch@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  const dr = await direct.user.create({
    data: { name: "D", email: "sch-dr@x.com", passwordHash: "x" } });
  const m = await direct.membership.create({
    data: { userId: dr.id, clinicId: clinic.id, role: "DENTIST" } });
  ctx = { userId: owner.id, clinicId: clinic.id };
  dentistMembershipId = m.id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("setWeeklySchedule", () => {
  it("replaces the weekly schedule atomically", async () => {
    await setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 1, startMin: 540, endMin: 1020 },
      { weekday: 2, startMin: 540, endMin: 1020 },
    ]);
    await setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 3, startMin: 600, endMin: 960 },
    ]);
    const rows = await direct.schedule.findMany({
      where: { membershipId: dentistMembershipId } });
    expect(rows.length).toBe(1);
    expect(rows[0].weekday).toBe(3);
  });
  it("rejects start >= end", async () => {
    await expect(setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 1, startMin: 600, endMin: 600 }]))
      .rejects.toThrow(ScheduleError);
  });
  it("rejects overlapping entries on the same weekday", async () => {
    await expect(setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 1, startMin: 540, endMin: 720 },
      { weekday: 1, startMin: 700, endMin: 900 }]))
      .rejects.toThrow(ScheduleError);
  });
});

describe("addException", () => {
  it("adds a closed day", async () => {
    const e = await addException(ctx, {
      membershipId: dentistMembershipId, date: "2026-11-28", closed: true });
    expect(e.closed).toBe(true);
  });
  it("rejects altered hours without times", async () => {
    await expect(addException(ctx, {
      membershipId: dentistMembershipId, date: "2026-11-29", closed: false }))
      .rejects.toThrow(ScheduleError);
  });
});
