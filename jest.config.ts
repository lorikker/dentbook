import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  // NOTE 1: testMatch globs are broken on Windows when the project path contains a
  // dot-prefixed directory segment (this worktree lives under `.claude/worktrees/...`) —
  // Jest's glob path normalizer misreads `\.` as an escaped dot and matches 0 files.
  // testRegex avoids the glob path entirely.
  // NOTE 2: files use a `.jest.tsx` suffix (not `.test.tsx`) because Vitest's default
  // `include` (`**/*.{test,spec}.*`, unrestricted in this repo's vitest.config.ts) would
  // otherwise pick these Jest-only files up too and fail on them (no `vitest.config.ts`
  // changes allowed here).
  testRegex: "tests-jest[\\\\/].*\\.jest\\.tsx?$",
  setupFiles: ["<rootDir>/tests-jest/setup-env.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests-jest/setup.ts"],
  transform: { "^.+\\.[tj]sx?$": ["babel-jest", { configFile: "./babel.config.jest.js" }] },
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
};
export default config;
