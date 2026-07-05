import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/helpers/global-setup.ts",
    setupFiles: ["./tests/helpers/setup-env.ts"],
    fileParallelism: false, // integration tests share one test DB
    testTimeout: 20000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
