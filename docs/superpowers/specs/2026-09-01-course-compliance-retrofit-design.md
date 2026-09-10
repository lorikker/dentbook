# Course-compliance retrofit of dentbook

**Date:** 2026-09-01
**Status:** Approved design
**Repo:** lorikker/dentbook (GitHub)

## 1. Purpose

Extend the existing dentbook multi-tenant dental booking SaaS (see
[2026-07-05-dentbook-design.md](2026-07-05-dentbook-design.md)) so it satisfies
every requirement of the "Zhvillim i Ueb-it në Anën e Klientit" course project
spec (100 points), literally — including requirements that name specific
technologies dentbook doesn't currently use (MongoDB, Pages Router data
fetching, Jest). The retrofit must not weaken dentbook's real architecture:
PostgreSQL + Row-Level Security stays the source of truth for all
clinic/booking data. New surfaces are additive; nothing that currently works
gets rewired.

## 2. Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Reuse dentbook or build separate course project | Extend dentbook |
| Rubric strictness | Literal API/technology matches required, not just equivalents |
| Products / Product Details mapping | New cross-clinic services catalog (not a reframe of existing Clinics pages) |
| MongoDB's 3 models | ContactMessage, ActivityLog, Testimonial |
| Cart or Favorites | Favorites — patients save clinics |
| Jest vs Vitest | Add Jest alongside Vitest, scoped to the required tests only |

## 3. Current state (gap analysis)

Already satisfied by the existing app (`src/app/[locale]/...`, App Router):
Home (`/`), Login, Register, Clinics list + detail, Dashboard (schedules,
services, staff, settings, requests), login-free manage/cancel page. Auth.js
is wired up (`src/auth.ts`). Prisma + PostgreSQL with RLS multi-tenancy is in
place with ~13 models already (User, Clinic, Appointment, Service,
Membership, Review, Payment, Subscription, etc. — see
[2026-07-05-dentbook-design.md](2026-07-05-dentbook-design.md) §6). Zod
validates at every boundary. `User.isPlatformAdmin` exists in the schema but
has no UI. No `components/` directory exists — UI is inline in page files.
No test files exist anywhere in the project. No MongoDB, no `pages/`
directory, no OAuth providers, no About/Contact/Profile/Admin/Favorites
pages.

## 4. Routing split

Existing `src/app/[locale]/...` (App Router, localized) is untouched. A new
`pages/` directory is added at the repo root for the three routes that must
literally use Pages Router data-fetching APIs:

- `pages/products/index.tsx`
- `pages/products/[id].tsx`
- `pages/favorites.tsx`

These are unlocalized (English only) — retrofitting next-intl into Pages
Router isn't required by the rubric and would add risk for no credit.

## 5. Data-fetching demonstration (rubric §7)

The rubric requires all four techniques to be clearly and meaningfully
demonstrated, not included as unused boilerplate:

- **`pages/products/index.tsx`** — `getStaticProps` with `revalidate: 60`,
  pulling all clinics' services from Postgres via Prisma. Demonstrates SSG +
  ISR together — genuinely justified because the services catalog changes
  infrequently but shouldn't require a full rebuild to update.
- **`pages/products/[id].tsx`** — `getStaticPaths` (pre-builds top services,
  `fallback: 'blocking'` for the rest) + `getStaticProps`. Demonstrates
  dynamic routes.
- **`pages/favorites.tsx`** — `getServerSideProps`, reading the session and
  the user's favorited clinics fresh on every request. Genuinely needs SSR:
  favorites are per-user and must never be stale or cached across users.

## 6. MongoDB slice (rubric §5)

Via Mongoose. `src/lib/mongo.ts` — cached-connection singleton (standard
Next.js pattern to avoid connection storms in dev), `MONGODB_URI` in
`.env.local`. Three models, deliberately scoped to data that is NOT
tenant-sensitive, so the Postgres RLS security model is never bypassed or
duplicated:

- **`ContactMessage`** — backs the Contact form (name, email, message,
  createdAt).
- **`ActivityLog`** — event feed (registrations, bookings, cancellations,
  clinic approvals), written by a small helper called from existing server
  actions/routes; rendered as a feed in the Admin Panel.
- **`Testimonial`** — flexible-shape public marketing content for
  Home/About (quote, author name, optional photo/role — shape intentionally
  looser than the structured `Review` model in Postgres), moderated
  (publish/hide) from the Admin Panel.

## 7. New pages (rubric §1)

- **`/about`** — static content: project description, team.
- **`/contact`** — form → writes to `ContactMessage` (Mongo).
- **`/profile`** — view + update name/email/locale, reusing the existing
  session from `src/auth.ts`.
- **`/admin`** — platform-admin only: pending clinic approvals, ActivityLog
  feed, Testimonial moderation. Gated on `User.isPlatformAdmin` (already in
  the Prisma schema, no UI yet).
- **`/favorites`** (Pages Router, see §4) — list of favorited clinics.

## 8. Auth & roles (rubric §3)

Add Google and Facebook providers to `src/auth.ts` alongside the existing
phone-OTP (patients) and email/password (staff) flows. OAuth sign-ins default
to the `user` role. Middleware gate for `/admin` checks `isPlatformAdmin`;
the existing gate for `/dashboard` (clinic membership) will be verified
during implementation, not assumed.

## 9. CRUD entities (rubric §4)

Services and Appointments already have Create/Read/Update in the dashboard.
Implementation will verify Delete exists for both and add it if missing,
rather than building new entities from scratch.

## 10. Reusable components (rubric §2)

No `components/` directory currently exists. Implementation will extract at
least Header, Footer, Card (used by Clinics list, Products, Favorites), and
Button into `src/components/`, and reuse them across both new and existing
pages rather than leaving this requirement unverified.

## 11. Forms (rubric §8)

Contact form and Profile-update form, both new, built with react-hook-form
(new dependency — not currently installed) with required-field validation,
inline error messages, and success messaging.

## 12. Testing (rubric §10)

Jest + RTL added alongside Vitest (`jest.config.ts`, separate `test:jest`
script) — scoped to the required tests only, not a full migration:

- 3 component tests: Card, Button, Header.
- 2 API route tests: Contact submission (Mongo write), one existing
  appointment/service route (Postgres write).

## 13. Deployment & docs (rubric §11–12)

README rewrite (description, setup, env vars, screenshots, live link, team
section) and `.env.local.example` covering all secrets (Postgres URL,
`MONGODB_URI`, `NEXTAUTH_SECRET`, Google/Facebook OAuth, Twilio). Done last,
once the surfaces exist to document and screenshot.

## 14. Sequencing

1. MongoDB slice (§6) — foundational, Contact page depends on it.
2. Pages Router routes: Products, Product Details, Favorites (§4–5).
3. Auth/OAuth + Admin panel (§8, §7 admin).
4. Remaining pages: About, Contact, Profile (§7).
5. Component extraction (§10).
6. Forms (§11).
7. Tests (§12).
8. Docs/deploy (§13).

Each numbered step above is scoped to become its own implementation plan via
the writing-plans skill, in this order.
