# Dentbook — Course Project Summary & Presentation Guide

**Course:** Zhvillim i Ueb-it në Anën e Klientit (Client-Side Web Development)
**Repo:** github.com/lorikker/dentbook (branch `master`, up to date with origin)
**Status:** All 8 planned sub-projects implemented, reviewed, and merged.

This document is for you, not for the instructor — it explains what already
existed, what was built for the course, how it maps to the rubric, and how to
demo it. It is intentionally not committed to git (kept local, like the other
planning docs in this folder).

---

## 1. The starting point

Dentbook was already a real, working multi-tenant dental-booking SaaS before
this course work started: Next.js App Router, PostgreSQL + Prisma with
Row-Level Security enforcing tenant isolation, phone-OTP + staff
email/password auth, a full booking flow (availability, slots, double-booking
prevention), a clinic dashboard (services, staff, schedules, requests,
settings), and a login-free manage/cancel-by-link flow. None of that was
built for the course — it's the actual product.

The course rubric (100 pts) requires specific things this app didn't have
yet, some naming specific technologies (MongoDB, Pages Router data-fetching
APIs, Jest) that don't otherwise fit a modern App Router/Postgres/Vitest
stack. Rather than build a disposable toy project to check boxes, the
decision (documented in
[`2026-09-01-course-compliance-retrofit-design.md`](2026-09-01-course-compliance-retrofit-design.md))
was to extend the real app, matching the rubric's literal technology
requirements without weakening the real architecture — Postgres+RLS stays
the source of truth for anything tenant-sensitive; MongoDB is scoped only to
data that was never tenant data in the first place.

## 2. What was added, mapped to the rubric

| Rubric requirement | What was built | Where |
|---|---|---|
| **10+ interconnected pages** | Added: About, Contact, Profile, Admin, Products, Product Details, Favorites. Combined with the pre-existing Home, Login, Register, Dashboard (6 sub-pages), Clinics list/detail, Book, Manage — well over 10. | `src/app/[locale]/*`, `src/pages/*` |
| **4+ reusable components** | `Header`, `Footer`, `Button`/`ButtonLink`, `Card` — used across the clinics list, products, favorites, about/contact/profile, and every locale page (via the layout). | `src/components/` |
| **NextAuth + OAuth + roles** | Google and Facebook providers added alongside the existing phone-OTP and staff-password flows. `isPlatformAdmin` (already in the schema) now gates a real Admin Panel. | `src/auth.ts`, `src/lib/oauth-user.ts` |
| **CRUD on 2+ entities** | Services: Create/Read/Update already existed; **Delete** added (`deleteService`). Appointments: Create/Read/Update/Cancel already existed. | `src/lib/services.ts` |
| **MongoDB, 3+ models** | `ContactMessage`, `ActivityLog`, `Testimonial` — deliberately scoped to non-tenant data so Postgres RLS is never duplicated or bypassed. | `src/lib/models/`, `src/lib/mongo.ts` |
| **React hooks / Context / custom hook** | `react-hook-form`'s `useForm` (Contact, Profile) plus this app's existing use of Server Components/Suspense patterns throughout. | `src/components/ProfileForm.tsx`, `src/app/[locale]/contact/page.tsx` |
| **SSR / SSG / ISR / getStaticPaths** | `/products` — `getStaticProps` + `revalidate: 60` (SSG+ISR). `/products/[id]` — `getStaticPaths` (+ `fallback: 'blocking'`) + `getStaticProps`. `/favorites` — `getServerSideProps` (SSR, per-user, never cached). | `src/pages/products/`, `src/pages/favorites.tsx` |
| **2+ forms, react-hook-form** | Contact form and Profile-update form, both client components with `useForm`, required-field validation, inline errors, success/error messaging. | `src/app/[locale]/contact/page.tsx`, `src/components/ProfileForm.tsx` |
| **Tailwind, responsive** | Used throughout, consistent with the app's existing styling conventions. | — |
| **Jest/RTL: 3 component + 2 API-route tests** | `Card`, `Button`, `Header` component tests. API-route tests: Contact submission (real in-memory-Mongo write) and the Profile PATCH route (HTTP-contract test). Runs alongside the existing Vitest integration suite. | `tests-jest/`, `jest.config.ts` |
| **Vercel deploy + README** | README rewritten with features, tech stack, setup, env vars, testing, deployment instructions. Live URL/screenshots are left as placeholders — see §4. | `README.md` |
| **Env var hygiene** | `.env.example` covers every secret (Postgres, Mongo, `AUTH_SECRET`, Google/Facebook OAuth, Twilio/SMS). No real secrets ever committed. | `.env.example` |

## 3. How it was built (if asked)

Built with an AI pair-programming workflow: a design was brainstormed and
written up first, then broken into a sequenced implementation plan, then
executed task-by-task (several tasks in parallel, in isolated Git worktrees,
to move faster), each with its own tests, then a final independent
whole-branch code review before merging to `master`. The review caught two
real bugs before merge — worth mentioning if asked about process/quality:

- OAuth sign-in could have silently taken over an existing password/admin
  account sharing the same email; fixed by requiring a verified email and
  blocking sign-in when the email already belongs to a password account.
- The MongoDB activity-log write was on the critical path for clinic
  registration and appointment booking; if Mongo hiccuped, a successful
  Postgres booking could have been reported to the user as failed. Fixed by
  making the log write non-fatal and moving it outside the database
  transaction.

Current verification state: `tsc` clean, 93/93 Vitest integration tests
passing (real Postgres + in-memory MongoDB, no mocking), 10/10 Jest tests
passing, production build succeeds.

## 4. Before you present: still open

- **Deploy to Vercel** and put the live URL + screenshots into the README
  (currently placeholders — the app was verified locally and via `next
  build`, not yet deployed). You'll need to set every var from
  `.env.example` in Vercel's project settings, pointed at a real Postgres +
  MongoDB instance, and run `npx prisma migrate deploy` against production
  before first deploy.
- **Team section** in the README — add real names/roles if this is a group
  submission.
- **Google/Facebook OAuth credentials** are placeholders (`change-me`) in
  `.env.example` — you'll need real OAuth app credentials for a live demo of
  that flow (or demo it as "wired up, credentials pending" and demo the
  phone-OTP/staff-password flows live instead).

## 5. Suggested demo flow

1. **Home → Clinics** — show the marketplace, filter by city, open a clinic,
   show services/dentists, book via phone OTP (no account needed).
2. **Products** (`/products`) — point out this is the Pages Router, SSG+ISR;
   open a product detail page (`getStaticPaths`) built from a pre-rendered
   path.
3. **Favorites** (`/favorites`) — log in, favorite a clinic from its detail
   page, show the favorites list is server-rendered per request (SSR).
4. **Contact** — submit the form, mention it's react-hook-form with
   validation, and that it's writing to MongoDB (not Postgres) — then show
   the same message appear in the Admin activity feed.
5. **Register a clinic** → **staff login** → **Dashboard** — the existing
   CRUD surfaces (services, staff, schedules), point out Delete on Services.
6. **Admin Panel** (`/admin`, needs `isPlatformAdmin`) — approve the clinic
   you just registered, show the activity feed, publish a testimonial.
7. **Profile** — update name/locale via the second react-hook-form form.
8. **Tests** — `npm test` (Vitest, real infra) and `npm run test:jest`
   (component + API-route tests) — good to have run once beforehand so you
   can just show the green output rather than live-run it.
