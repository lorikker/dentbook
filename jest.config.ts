import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  // NOTE 1: testMatch globs are broken on Windows when the project path contains a
  // dot-prefixed directory segment (this worktree lives under `.claude/worktrees/...`) —
  // Jest's glob path normalizer misreads `\.` as an escaped dot and matches 0 files.
  // testRegex avoids the glob path entirely.
  // NOTE 2: files use a `.jest.tsx` suffix (not `.test.tsx`) because Vitest's default
  // `include` (`**/*.{test,spec}.*`) would otherwise pick these Jest-only files up too.
  testRegex: "tests-jest[\\/].*\.jest\.tsx?$",
  // NOTE 3: stale agent worktrees under `.claude/worktrees/<id>/tests-jest/` hold their
  // own copies of these files. testRegex is unanchored, so without this the suite runs
  // every copy against this repo's src (13 suites instead of 5) and they fail on drift.
  // Mirrors the `include` anchor in vitest.config.ts.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.claude/", "<rootDir>/.next/"],
  setupFiles: ["<rootDir>/tests-jest/setup-env.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests-jest/setup.ts"],
  transform: { "^.+\.[tj]sx?$": ["babel-jest", { configFile: "./babel.config.jest.js" }] },
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
};
export default config;
