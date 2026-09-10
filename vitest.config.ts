import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Anchored at the repo root so stale agent worktrees under
    // `.claude/worktrees/<id>/tests/` aren't collected as well — without
    // this the suite re-runs every copy of itself (152 files instead of 25).
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", ".next/**"],
    globalSetup: "./tests/helpers/global-setup.ts",
    setupFiles: ["./tests/helpers/setup-env.ts"],
    fileParallelism: false, // integration tests share one test DB
    testTimeout: 20000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
