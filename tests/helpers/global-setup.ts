import { execSync } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";
import "dotenv/config";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup({ provide }: TestProject) {
  // prisma.config.ts reads DIRECT_DATABASE_URL; point it at the test DB.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: process.env.TEST_DIRECT_DATABASE_URL,
    },
  });

  const mongod = await MongoMemoryServer.create();
  provide("mongoUri", mongod.getUri());

  return async () => {
    await mongod.stop();
  };
}
