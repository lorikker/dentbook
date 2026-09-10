# Dentbook

Dentbook is a multi-tenant dental booking platform for Kosovo. Patients browse
clinics and services, book appointments (with or without an account), and
leave reviews. Clinics manage their own schedules, staff, and services from a
dashboard. A platform admin approves new clinics and moderates public
content.

## Features

- **Public marketplace** — browse clinics (`/clinics`), view a clinic's
  services and dentists, book an appointment by phone (OTP, no account
  required), and manage/cancel a booking via a link (no login).
- **Products catalog** (`/products`) — a cross-clinic services catalog,
  server-rendered with static generation + incremental revalidation.
- **Favorites** (`/favorites`) — patients save clinics they like; requires an
  account, rendered fresh per request.
- **Auth** — phone OTP for patients, email/password for clinic staff, and
  Google / Facebook OAuth, via [Auth.js](https://authjs.dev).
- **Verified reviews** — after a visit is marked COMPLETED, the patient gets
  a review invitation via their manage link; one review per appointment.
  Admins moderate submissions (publish/hide) from `/admin`.
- **Deposits** — services can require a deposit, taken through a mock
  payment provider (`/pay/[token]`, no real money moves). An unpaid deposit
  holds the slot for 15 minutes before it's released automatically.
- **24-hour reminders** — a confirmed appointment gets a reminder SMS 24
  hours before its start.
- **Subscription invoicing** — clinics are billed monthly (Trial / Basic /
  Pro). The platform admin issues invoices, marks them paid, and sees a
  clinic flagged overdue after the grace period — plans don't gate any
  feature in this version.
- **Testimonials** — visitors submit a testimonial from `/about`; it stays
  unpublished until an admin approves it, then appears on the home page.
- **Scheduled jobs** — daily housekeeping (deposit expiry, stale request
  cleanup, reminders, subscription rollover, OTP pruning) via Vercel Cron.
  See [Scheduled jobs](#scheduled-jobs) below.
- **Clinic dashboard** — staff manage appointments, requests, services,
  staff members, weekly schedules, and clinic settings.
- **Admin panel** (`/admin`, platform-admin only) — approve pending clinics,
  review a live activity feed, moderate public testimonials and reviews,
  manage subscriptions/invoices, and trigger scheduled jobs on demand.
- **About / Contact / Profile** pages, with the Contact form, the About page's
  testimonial form, and the Profile form built on
  [react-hook-form](https://react-hook-form.com) / server actions.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, plus a small Pages Router slice for `products`/`favorites`) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| i18n | next-intl (Albanian / English) |
| Auth | Auth.js (NextAuth v5), JWT sessions |
| Primary database | PostgreSQL, via Prisma, with Row-Level Security enforcing multi-tenancy |
| Secondary database | MongoDB, via Mongoose — scoped to non-tenant data (contact messages, activity log, testimonials) |
| Testing | Vitest (integration tests against real Postgres/Mongo) + Jest/React Testing Library (component and API-route tests) |

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 17 running locally (or update `DATABASE_URL` to point elsewhere)
- MongoDB running locally (only needed for `npm run dev` — tests spin up an
  in-memory MongoDB automatically)

### Setup

```bash
npm install
cp .env.example .env      # then fill in real values, see below
npm run db:start          # starts the local Postgres instance (set PG_BIN if PostgreSQL 17 isn't in C:\Program Files)
npm run db:migrate        # applies all Prisma migrations
npm run db:seed           # optional: seed sample data
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

See [`.env.example`](.env.example) for the full list with placeholder
values. Summary:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection, RLS-enforced app role |
| `DIRECT_DATABASE_URL` | Postgres connection, superuser (migrations/seed) |
| `TEST_DATABASE_URL` / `TEST_DIRECT_DATABASE_URL` | Same, pointed at a separate test database |
| `AUTH_SECRET` | Auth.js session encryption |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | Facebook OAuth |
| `OTP_PEPPER` | Secret added when hashing patient OTP codes |
| `SMS_PROVIDER` | `console` (logs codes), `vonage`, or `twilio` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Twilio credentials and sender number, required when `SMS_PROVIDER=twilio` |
| `VONAGE_API_KEY` / `VONAGE_API_SECRET` / `VONAGE_FROM` | Vonage credentials and sender ID, required when `SMS_PROVIDER=vonage` |
| `MONGODB_URI` | MongoDB connection (contact messages, activity log, testimonials) |
| `CRON_SECRET` | Bearer token required by `GET /api/cron/tick` (Vercel Cron sends it automatically once set) |

## Testing

```bash
npm test        # Vitest: integration tests against real Postgres + in-memory MongoDB
npm run test:jest  # Jest + React Testing Library: component tests and API-route tests
```

## Scheduled jobs

`runScheduledJobs()` (`src/lib/cron.ts`) runs five housekeeping jobs in
turn — one failing doesn't stop the rest: expiring unpaid deposit holds,
declining stale pending requests, sending due 24-hour reminders, rolling
over subscriptions/invoices, and pruning expired OTP codes.

- **In production:** `vercel.json` schedules `GET /api/cron/tick` for
  `0 17 * * *` (17:00 UTC, daily — the only frequency the Vercel Hobby plan
  allows). That time reminds every appointment in clinic hours the evening
  before, per the 24-hour reminder window. Deposit holds expire on every
  booking attempt too, so they don't depend on the cron running on time.
  The route requires `Authorization: Bearer $CRON_SECRET`, which Vercel Cron
  sends automatically once `CRON_SECRET` is set on the project.
- **Locally:** `npm run cron:tick` runs the same jobs directly (no HTTP call,
  no `CRON_SECRET` needed) and prints the JSON summary, exiting 1 if any job
  failed.
- **On demand:** the platform admin panel (`/admin`) has a "Run scheduled
  jobs now" button that calls the same jobs for an ad-hoc run.

## Deployment

Deploy on [Vercel](https://vercel.com/new). Set every variable from
`.env.example` in the project's environment settings, pointed at your
production Postgres and MongoDB instances — including `CRON_SECRET`, so
Vercel Cron can call `/api/cron/tick` — and run `npx prisma migrate
deploy` against the production database before the first deploy.

- **Live URL:** _add once deployed_
- **Screenshots:** _add here_

## Team

Course project for *Zhvillim i Ueb-it në Anën e Klientit*.

- _add team member names/roles here_
