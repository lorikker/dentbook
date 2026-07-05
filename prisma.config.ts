import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // CLI connection (migrate/introspect/seed): superuser, NOT the RLS-enforced app role
  datasource: { url: env("DIRECT_DATABASE_URL") },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
