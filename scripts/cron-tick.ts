// Runs the same housekeeping jobs as GET /api/cron/tick, straight from the
// command line — handy locally, and as a manual trigger if the Vercel Cron
// run needs to be re-fired.
//
// Usage: npm run cron:tick
import "dotenv/config";
import { runScheduledJobs } from "../src/lib/cron";

async function main() {
  const summary = await runScheduledJobs();
  console.log(JSON.stringify(summary, null, 2));
  const failed = Object.values(summary).some((r) => !r.ok);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
