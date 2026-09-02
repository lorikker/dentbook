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
- **Clinic dashboard** — staff manage appointments, requests, services,
  staff members, weekly schedules, and clinic settings.
- **Admin panel** (`/admin`, platform-admin only) — approve pending clinics,
  review a live activity feed, and moderate public testimonials.
- **About / Contact / Profile** pages, with the Contact form and the Profile
  form built on [react-hook-form](https://react-hook-form.com).

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
npm run db:start          # starts the local Postgres instance (Windows path baked in — adjust for your OS)
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
| `SMS_PROVIDER` | `console` for local dev (logs codes instead of sending SMS) |
| `MONGODB_URI` | MongoDB connection (contact messages, activity log, testimonials) |

## Testing

```bash
npm test        # Vitest: integration tests against real Postgres + in-memory MongoDB
npm run test:jest  # Jest + React Testing Library: component tests and API-route tests
```

## Deployment

Deploy on [Vercel](https://vercel.com/new). Set every variable from
`.env.example` in the project's environment settings, pointed at your
production Postgres and MongoDB instances, and run `npx prisma migrate
deploy` against the production database before the first deploy.

- **Live URL:** _add once deployed_
- **Screenshots:** _add here_

## Team

Course project for *Zhvillim i Ueb-it në Anën e Klientit*.

- _add team member names/roles here_
