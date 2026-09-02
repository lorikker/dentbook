# Task E2 — Profile page with react-hook-form

## Files created
- `src/lib/profile.ts` — `updateProfile`/`ProfileError`, Zod-validated, `withDbContext({role:"auth"})`.
- `tests/profile.test.ts` — TDD (red confirmed before implementation, green after).
- `src/app/api/profile/route.ts` — PATCH endpoint.
- `src/app/[locale]/profile/page.tsx` — Server Component; fetches `name`/`email`/`locale` from Postgres via `withDbContext` (not from session, since `locale` isn't on the session type).
- `src/components/ProfileForm.tsx` — Client Component, react-hook-form.
- `src/components/Button.tsx` — **not part of the spec's file list, created because it didn't exist in this worktree** (see Deviations below). Content copied verbatim from `worktree-mongodb-slice`'s `Button.tsx` (commit `5f58ddd`) to minimize future merge conflicts.
- `src/messages/en.json`, `src/messages/sq.json` — added `Profile` namespace (`title`, `name`, `email`, `required`, `save`, `success`, `error`).

## Deviations from briefing (read before merging)
This worktree's branch point (`89a848b`) predates `worktree-mongodb-slice`'s later commits (`5f58ddd` reusable components incl. `Button.tsx`, `e07630e` Favorites, `4ede674` Pages Router routes). None of those exist here:
- `src/components/Button.tsx` did not exist — created it (content identical to `worktree-mongodb-slice`'s version) since `ProfileForm.tsx` needs it per spec.
- `src/app/[locale]/layout.tsx` does **not** render Header/Footer (contrary to briefing) — left untouched, out of scope.
- No Favorites model/lib, no `pages/` router routes exist in this worktree — irrelevant to this task, not touched.
- Baseline test count was 82 passing (not 88) for the same reason — `tests/favorites.test.ts` (~6 tests, would bring it to 88) lives on `worktree-mongodb-slice` only, which hadn't merged into this branch's ancestry. Confirmed via `git diff --stat 89a848b worktree-mongodb-slice -- tests/`.
- Saw transient, non-reproducible test failures (FK violations, empty result sets) on the first couple of `npm test` runs — traced to the shared Postgres instance on port 5433 being concurrently truncated by another agent's test run in a sibling worktree, not a real regression. Re-runs in isolation were clean.

Whoever merges this branch with `worktree-mongodb-slice` should expect a likely no-op/clean merge on `Button.tsx` (identical content) and should double check `layout.tsx`/Header-Footer wiring separately.

## Test results
- `npx tsc --noEmit`: clean, no errors.
- `npm test`: **21 test files passed, 84/84 tests passed** (82 pre-existing + 2 new in `tests/profile.test.ts`), run twice for stability, 0 regressions.
- `npm run build`: succeeded. `/[locale]/profile` and `/api/profile` both compiled as dynamic routes.

## Status
DONE — Profile page, API route, and lib function implemented and verified; see Deviations section for one pragmatic addition (`Button.tsx`) required because this worktree's branch point predates the reusable-components merge the briefing assumed was present.
