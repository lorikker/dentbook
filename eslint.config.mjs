import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Stale agent worktrees carry full copies of this repo (their own src/ and
    // node_modules/). Linting them buried the real findings under ~40k problems
    // from code this repo does not ship. Mirrors the anchors in
    // vitest.config.ts and jest.config.ts.
    ".claude/**",
  ]),
]);

export default eslintConfig;
