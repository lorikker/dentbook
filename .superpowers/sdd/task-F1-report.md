# Task F1 report: Jest+RTL infra, 3 component tests, deleteService

## Environment note (fixed before starting)
The worktree was branched from `worktree-mongodb-slice` at commit `89a848b`, *before*
the Header/Footer/Button/Card extraction, Favorites, and Pages Router commits were
added to that branch. The task brief assumed those were already present. Since HEAD
was exactly the merge-base, fast-forwarded onto `worktree-mongodb-slice` (`git merge
--ff-only worktree-mongodb-slice`, 89a848b -> 4ede674) to pick up
`src/components/{Header,Footer,Button,Card,PagesNav}.tsx`, `src/lib/favorites.ts`,
`tests/favorites.test.ts`, and the Pages Router routes before doing any task work.

## Files created
- `babel.config.jest.js` — Babel config isolated from Next's SWC pipeline, used only by Jest.
- `jest.config.ts` — Jest config (jsdom env, `@/` alias, ts/tsx via babel-jest).
- `tests-jest/setup.ts` — imports `@testing-library/jest-dom`.
- `tests-jest/Card.jest.tsx`, `tests-jest/Button.jest.tsx`, `tests-jest/Header.jest.tsx` — 3 component tests (5 test cases total).

## Files modified
- `src/lib/services.ts` — added `deleteService(ctx, id)`. Reused the file's existing `ctxOf(ctx)` helper (matches `listServices`/`createService`/`updateService` convention) instead of inlining the context object. `ServiceError`'s code union already included `"NOT_FOUND"` (used by `updateService`), so no change needed there.
- `tests/services.test.ts` — added 2 tests: deletes a service the staff owns (confirmed absent from `listServices`), and asserts deleting another clinic's service throws `ServiceError`. TDD: wrote both tests first, confirmed `TypeError: deleteService is not a function` (2 failing), implemented, confirmed passing.
- `package.json` — added `"test:jest": "jest"` script and the new devDependencies (jest, @testing-library/react, @testing-library/jest-dom, @testing-library/dom, jest-environment-jsdom, @types/jest, ts-node, babel-jest, @babel/preset-env, @babel/preset-react, @babel/preset-typescript). Did not touch the `"test"` script.
- `package-lock.json` — updated by npm install.

## Deviations from the literal spec (both forced by environment constraints, not preference)

1. **`npm install` needed `--legacy-peer-deps`.** Plain `npm install -D ...` failed with a
   spurious ERESOLVE error (`Found: react-dom@undefined` despite `react-dom@19.2.4` being
   installed and satisfying `@testing-library/react`'s `^18||^19` peer range — looks like an
   npm resolver bug, not a real conflict). Verified core deps (`react`, `react-dom`, `next`)
   are unchanged after install — only new devDependencies were added.

2. **`@testing-library/dom` had to be installed explicitly.** It's a peer dependency (not a
   regular dependency) of `@testing-library/react@16`, so the first install left it missing
   and Jest failed with `Cannot find module '@testing-library/dom'` until added.

3. **`jest.config.ts` uses `testRegex` instead of `testMatch`.** Windows + this worktree's
   path (`...\.claude\worktrees\...`) breaks Jest's glob-based `testMatch`: Jest's path
   normalizer converts `rootDir`'s backslashes to forward slashes for glob matching, but
   misreads the `\.` before `.claude` as an escaped literal dot (a valid glob escape token)
   and leaves it as a backslash, corrupting the pattern so it matches 0 files. `testRegex`
   sidesteps the glob path entirely and works correctly. Also dropped the spec's
   `setupFilesAfterEach: undefined` line — that's not a valid field in Jest's `Config` type
   (only `setupFiles`/`setupFilesAfterEnv` exist) and would fail `tsc --noEmit`.

4. **Jest test files are named `*.jest.tsx`, not `*.test.tsx`.** This repo's
   `vitest.config.ts` has no `include`/`exclude` restricting its scope, so Vitest's
   (unconfigurable-by-me) default `include` — `**/*.{test,spec}.?(c|m)[jt]s?(x)` — would
   also pick up files named `Card.test.tsx` etc. under `tests-jest/` and try to run them.
   That crashes: Card/Button fail with `ReferenceError: describe is not defined` (Vitest
   globals are off by default, and these Jest files rely on Jest's ambient globals rather
   than importing from `vitest`), and Header fails at import time (`@/components/Header` →
   `@/auth` → `next-auth` → unresolvable `next/server` under Vitest's node environment) —
   before any test code even runs. I considered guarding the `describe()` calls behind
   `process.env.VITEST` instead of renaming, but Vitest treats a test file with zero
   registered tests as a failure ("No test suite found in file"), so that would not have
   produced 0 regressions either. Renaming so the immediate pre-extension segment is
   `jest` instead of `test`/`spec` avoids Vitest's glob entirely with no config changes and
   no fragile runtime guards. `jest.config.ts`'s `testRegex` was updated to match
   `tests-jest/*.jest.tsx`. Both suites now run in full isolation with zero overlap.

No `vitest.config.ts`, `tests/helpers/**` (besides the one `deleteService` test), `src/auth.ts`,
admin/about/contact/profile routes, or `pages/`/`src/pages/` files were touched.

## Exact results

### Vitest (`npm test`)
```
 Test Files  21 passed (21)
      Tests  90 passed (90)
```
88 baseline + 2 new `deleteService` tests = 90. 0 regressions. (Note: while iterating, `npm test`
intermittently showed unrelated failures — deadlocks in `truncateAll`, cross-file data races —
caused by *other concurrent agent worktrees* running their own `npm test` against the same
shared Postgres instance on port 5433 at the same time; `vitest.config.ts` already sets
`fileParallelism: false` specifically because "integration tests share one test DB", so this
isn't an isolation bug in this suite itself. Re-running in isolation is consistently clean.)

### Jest (`npm run test:jest`)
```
Test Suites: 3 passed, 3 total
Tests:       5 passed, 5 total
```
Card: 2 tests (title/subtitle render, href renders as link). Button: 2 tests (native `<button>`
render, `ButtonLink` renders `<a href>`). Header: 1 test (nav links to `/clinics`, `/products`,
`/about`, `/contact` present; `/login` link present when `auth()` mock resolves `null`) —
rendered via `render(await Header())`, mocking `@/auth` (`auth`, `signOut`) and
`next-intl/server`'s `getTranslations` per the brief.

### `npx tsc --noEmit`
Clean, exit 0.

## Status
DONE
