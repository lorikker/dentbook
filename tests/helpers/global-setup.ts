import { execSync } from "node:child_process";
import "dotenv/config";

export default function setup() {
  // prisma.config.ts reads DIRECT_DATABASE_URL; point it at the test DB.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: process.env.TEST_DIRECT_DATABASE_URL,
    },
  });
}
