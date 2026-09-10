/**
 * @jest-environment node
 */
// The jobs themselves are covered against a real database by the Vitest suite
// (tests/cron.test.ts). Here the lib boundary is mocked so this test can pin
// the route's own contract: who may trigger the jobs.
jest.mock("@/lib/cron", () => ({ runScheduledJobs: jest.fn() }));

import { GET } from "@/app/api/cron/tick/route";
import { runScheduledJobs } from "@/lib/cron";

const call = (authorization?: string) =>
  GET(new Request("http://localhost/api/cron/tick",
    { headers: authorization ? { authorization } : {} }));

describe("GET /api/cron/tick", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = "s3cret";
    (runScheduledJobs as jest.Mock).mockResolvedValue({ reminders: { ok: true, result: 2 } });
  });
  afterAll(() => { process.env.CRON_SECRET = original; });

  it("runs the jobs for the configured bearer secret and returns their summary", async () => {
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reminders: { ok: true, result: 2 } });
    expect(runScheduledJobs).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "Bearer wrong", "s3cret", "Bearer s3cret-and-more"])(
    "refuses %s without running anything", async (authorization) => {
      const res = await call(authorization);
      expect(res.status).toBe(401);
      expect(runScheduledJobs).not.toHaveBeenCalled();
    });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await call("Bearer undefined");
    expect(res.status).toBe(500);
    expect(runScheduledJobs).not.toHaveBeenCalled();
  });
});
