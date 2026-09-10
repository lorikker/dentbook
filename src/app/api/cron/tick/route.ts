import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runScheduledJobs } from "@/lib/cron";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that variable
// is set on the project; anything else is refused.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must not leave the jobs open to anyone.
    return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  }
  if (!matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json(await runScheduledJobs());
}

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
