# Dentbook Phase 1 — Foundation & Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Next.js app with a fully-migrated multi-tenant Postgres schema whose Row-Level Security provably isolates clinics, working auth (patient phone-OTP with console SMS + staff email/password), Albanian/English i18n, and seeded demo data.

**Architecture:** Single Next.js (App Router) monolith talking to PostgreSQL through Prisma. The app connects as a non-superuser role (`dentbook_app`) subject to RLS; every query runs inside a transaction that sets `app.user_id` / `app.clinic_id` / `app.role` session variables which the RLS policies read. Migrations run as superuser via `DIRECT_DATABASE_URL`.

**Tech Stack:** Next.js 15 (App Router, TS), Prisma 6, PostgreSQL 16 (Docker), Auth.js (next-auth v5), next-intl, Zod, bcryptjs, Vitest.

**Plan sequence:** This is Plan 1 of 5 (Foundation → Dashboard → Booking → Monetization/Admin → Subdomains/E2E/Prod). Later plans are written after this one ships.

**Spec:** `docs/superpowers/specs/2026-07-05-dentbook-design.md`

---

## File structure created by this plan

```
dentbook/
├── docker-compose.yml              # Postgres 16 for dev+test
├── docker/postgres-init.sql        # app role, test db, default privileges
├── .env / .env.example             # connection strings, secrets
├── vitest.config.ts                # unit + integration test runner
├── prisma/
│   ├── schema.prisma               # all core models (spec §6)
│   ├── seed.ts                     # demo clinics/staff/services
│   └── migrations/
│       ├── <ts>_init/              # generated from schema
│       └── <ts>_rls/migration.sql  # RLS policies, helper fns, exclusion constraint
├── src/
│   ├── lib/
│   │   ├── db.ts                   # PrismaClient singletons (app + direct)
│   │   ├── tenant-db.ts            # withDbContext() — sets RLS session vars
│   │   ├── otp.ts                  # requestOtp / verifyOtp (+ rate limits)
│   │   ├── staff-auth.ts           # password hash/verify
│   │   └── sms/
│   │       ├── types.ts            # SmsProvider interface
│   │       ├── console.ts          # dev provider (logs to stdout)
│   │       └── index.ts            # provider selection by env
│   ├── auth.ts                     # Auth.js config (2 credentials providers)
│   ├── app/api/auth/[...nextauth]/route.ts
│   ├── middleware.ts               # next-intl locale routing
│   ├── i18n/routing.ts, i18n/request.ts
│   ├── app/[locale]/layout.tsx, page.tsx, login/page.tsx
│   └── messages/sq.json, en.json
└── tests/
    ├── helpers/db.ts               # test clients + truncate helper
    ├── rls-isolation.test.ts       # THE tenant-isolation proof
    ├── otp.test.ts
    └── staff-auth.test.ts
```

---

### Task 1: Scaffold app, tooling, and dev database

**Files:**
- Create: entire Next.js scaffold (via CLI), `docker-compose.yml`, `docker/postgres-init.sql`, `.env`, `.env.example`, `vitest.config.ts`
- Modify: `package.json` (scripts), `.gitignore`

- [ ] **Step 1: Scaffold Next.js into the existing repo**

Run from `C:\Users\Lorik\source\dentbook`:

```powershell
npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

Expected: scaffold completes; `package.json`, `src/app/` exist. (If it balks at the non-empty dir because of `docs/`, scaffold into `tmp-scaffold`, move its contents up, delete `tmp-scaffold`.)

- [ ] **Step 2: Install dependencies**

```powershell
npm install prisma @prisma/client zod next-intl next-auth@beta bcryptjs
npm install -D vitest tsx dotenv @types/bcryptjs
```

Expected: installs succeed.

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: dentbook
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  pgdata:
```

- [ ] **Step 4: Create `docker/postgres-init.sql`**

App role is NOT superuser and does NOT own tables → RLS applies to it. Default privileges make future tables (created by migrations as `postgres`) readable/writable by the app role.

```sql
CREATE ROLE dentbook_app LOGIN PASSWORD 'app_pw';
GRANT CONNECT ON DATABASE dentbook TO dentbook_app;

CREATE DATABASE dentbook_test;
GRANT CONNECT ON DATABASE dentbook_test TO dentbook_app;

\connect dentbook
GRANT USAGE ON SCHEMA public TO dentbook_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dentbook_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO dentbook_app;

\connect dentbook_test
GRANT USAGE ON SCHEMA public TO dentbook_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dentbook_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO dentbook_app;
```

- [ ] **Step 5: Start Postgres**

```powershell
docker compose up -d
docker compose ps
```

Expected: `postgres` service healthy. (If a previous volume exists without the init script: `docker compose down -v` first.)

- [ ] **Step 6: Create `.env` and `.env.example`** (same content; `.env.example` uses placeholder secrets)

```bash
# App connections (RLS-enforced role)
DATABASE_URL="postgresql://dentbook_app:app_pw@localhost:5432/dentbook"
# Superuser connection: migrations, seed, test setup
DIRECT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dentbook"
# Test database
TEST_DATABASE_URL="postgresql://dentbook_app:app_pw@localhost:5432/dentbook_test"
TEST_DIRECT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dentbook_test"

AUTH_SECRET="dev-secret-change-in-prod"
OTP_PEPPER="dev-pepper-change-in-prod"
SMS_PROVIDER="console"
```

Confirm `.gitignore` covers `.env*` (create-next-app default does; `.env.example` must be force-added later with `git add -f .env.example` or un-ignored via `!.env.example` line — add the `!.env.example` line to `.gitignore`).

- [ ] **Step 7: Create `vitest.config.ts`**

```ts
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
```

- [ ] **Step 8: Add scripts to `package.json`** (merge into existing `scripts`)

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "db:migrate": "prisma migrate dev",
  "db:seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 9: Verify the scaffold builds**

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 10: Commit**

```powershell
git add -A; git add -f .env.example
git commit -m "chore: scaffold Next.js app, Docker Postgres, test tooling"
```

---

### Task 2: Prisma schema (all core models) + init migration

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`
- Migration: `prisma/migrations/<ts>_init/`

- [ ] **Step 1: Write `prisma/schema.prisma`** (full spec §6 model)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

enum MembershipRole {
  OWNER
  DENTIST
  RECEPTIONIST
}

enum BookingMode {
  INSTANT
  APPROVAL
}

enum AppointmentStatus {
  PENDING
  CONFIRMED
  DECLINED
  CANCELLED
  COMPLETED
  NO_SHOW
}

enum ReviewStatus {
  PUBLISHED
  HIDDEN
}

enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
  REFUNDED
}

enum SubscriptionPlan {
  TRIAL
  BASIC
  PRO
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELLED
}

enum InvoiceStatus {
  OPEN
  PAID
  VOID
}

enum NotificationChannel {
  SMS
  EMAIL
}

enum NotificationStatus {
  SCHEDULED
  SENT
  FAILED
}

model User {
  id              String        @id @default(uuid()) @db.Uuid
  phone           String?       @unique
  email           String?       @unique
  passwordHash    String?       @map("password_hash")
  name            String
  locale          String        @default("sq")
  isPlatformAdmin Boolean       @default(false) @map("is_platform_admin")
  createdAt       DateTime      @default(now()) @map("created_at")
  memberships     Membership[]
  appointments    Appointment[]
  reviews         Review[]

  @@map("users")
}

model Clinic {
  id                      String              @id @default(uuid()) @db.Uuid
  slug                    String              @unique
  name                    String
  city                    String
  address                 String
  phone                   String
  aboutSq                 String              @default("") @map("about_sq")
  aboutEn                 String              @default("") @map("about_en")
  logoUrl                 String?             @map("logo_url")
  brandColor              String              @default("#0ea5e9") @map("brand_color")
  bookingMode             BookingMode         @default(INSTANT) @map("booking_mode")
  cancellationWindowHours Int                 @default(24) @map("cancellation_window_hours")
  timezone                String              @default("Europe/Belgrade")
  published               Boolean             @default(false)
  approvedAt              DateTime?           @map("approved_at")
  createdAt               DateTime            @default(now()) @map("created_at")
  memberships             Membership[]
  services                Service[]
  scheduleExceptions      ScheduleException[]
  appointments            Appointment[]
  reviews                 Review[]
  payments                Payment[]
  subscription            Subscription?
  notifications           Notification[]

  @@map("clinics")
}

model Membership {
  id           String           @id @default(uuid()) @db.Uuid
  userId       String           @map("user_id") @db.Uuid
  clinicId     String           @map("clinic_id") @db.Uuid
  role         MembershipRole
  title        String?
  bio          String?
  photoUrl     String?          @map("photo_url")
  createdAt    DateTime         @default(now()) @map("created_at")
  user         User             @relation(fields: [userId], references: [id])
  clinic       Clinic           @relation(fields: [clinicId], references: [id])
  services     DentistService[]
  schedules    Schedule[]
  exceptions   ScheduleException[]
  appointments Appointment[]

  @@unique([userId, clinicId])
  @@map("memberships")
}

model Service {
  id          String           @id @default(uuid()) @db.Uuid
  clinicId    String           @map("clinic_id") @db.Uuid
  nameSq      String           @map("name_sq")
  nameEn      String           @map("name_en")
  durationMin Int              @map("duration_min")
  priceEur    Decimal          @map("price_eur") @db.Decimal(10, 2)
  depositEur  Decimal?         @map("deposit_eur") @db.Decimal(10, 2)
  active      Boolean          @default(true)
  clinic      Clinic           @relation(fields: [clinicId], references: [id])
  dentists    DentistService[]
  appointments Appointment[]

  @@map("services")
}

model DentistService {
  membershipId String     @map("membership_id") @db.Uuid
  serviceId    String     @map("service_id") @db.Uuid
  membership   Membership @relation(fields: [membershipId], references: [id])
  service      Service    @relation(fields: [serviceId], references: [id])

  @@id([membershipId, serviceId])
  @@map("dentist_services")
}

model Schedule {
  id           String     @id @default(uuid()) @db.Uuid
  membershipId String     @map("membership_id") @db.Uuid
  weekday      Int // 0=Sunday .. 6=Saturday
  startMin     Int        @map("start_min") // minutes from midnight, clinic tz
  endMin       Int        @map("end_min")
  membership   Membership @relation(fields: [membershipId], references: [id])

  @@map("schedules")
}

model ScheduleException {
  id           String      @id @default(uuid()) @db.Uuid
  clinicId     String      @map("clinic_id") @db.Uuid
  membershipId String?     @map("membership_id") @db.Uuid // null = clinic-wide
  date         DateTime    @db.Date
  closed       Boolean     @default(true)
  startMin     Int?        @map("start_min") // set when altered hours instead of closed
  endMin       Int?        @map("end_min")
  clinic       Clinic      @relation(fields: [clinicId], references: [id])
  membership   Membership? @relation(fields: [membershipId], references: [id])

  @@map("schedule_exceptions")
}

model Appointment {
  id            String            @id @default(uuid()) @db.Uuid
  clinicId      String            @map("clinic_id") @db.Uuid
  membershipId  String            @map("membership_id") @db.Uuid // the dentist
  patientUserId String            @map("patient_user_id") @db.Uuid
  serviceId     String            @map("service_id") @db.Uuid
  startsAt      DateTime          @map("starts_at")
  endsAt        DateTime          @map("ends_at")
  status        AppointmentStatus
  notes         String?
  manageToken   String            @unique @default(uuid()) @map("manage_token")
  createdAt     DateTime          @default(now()) @map("created_at")
  clinic        Clinic            @relation(fields: [clinicId], references: [id])
  membership    Membership        @relation(fields: [membershipId], references: [id])
  patient       User              @relation(fields: [patientUserId], references: [id])
  service       Service           @relation(fields: [serviceId], references: [id])
  review        Review?
  payment       Payment?

  @@map("appointments")
}

model Review {
  id            String       @id @default(uuid()) @db.Uuid
  clinicId      String       @map("clinic_id") @db.Uuid
  patientUserId String       @map("patient_user_id") @db.Uuid
  appointmentId String       @unique @map("appointment_id") @db.Uuid
  rating        Int
  comment       String?
  status        ReviewStatus @default(PUBLISHED)
  createdAt     DateTime     @default(now()) @map("created_at")
  clinic        Clinic       @relation(fields: [clinicId], references: [id])
  patient       User         @relation(fields: [patientUserId], references: [id])
  appointment   Appointment  @relation(fields: [appointmentId], references: [id])

  @@map("reviews")
}

model Payment {
  id            String        @id @default(uuid()) @db.Uuid
  clinicId      String        @map("clinic_id") @db.Uuid
  appointmentId String?       @unique @map("appointment_id") @db.Uuid
  amountEur     Decimal       @map("amount_eur") @db.Decimal(10, 2)
  provider      String
  providerRef   String?       @map("provider_ref")
  status        PaymentStatus @default(PENDING)
  createdAt     DateTime      @default(now()) @map("created_at")
  clinic        Clinic        @relation(fields: [clinicId], references: [id])
  appointment   Appointment?  @relation(fields: [appointmentId], references: [id])

  @@map("payments")
}

model Subscription {
  id               String             @id @default(uuid()) @db.Uuid
  clinicId         String             @unique @map("clinic_id") @db.Uuid
  plan             SubscriptionPlan   @default(TRIAL)
  status           SubscriptionStatus @default(ACTIVE)
  trialEndsAt      DateTime?          @map("trial_ends_at")
  currentPeriodEnd DateTime?          @map("current_period_end")
  clinic           Clinic             @relation(fields: [clinicId], references: [id])
  invoices         Invoice[]

  @@map("subscriptions")
}

model Invoice {
  id             String        @id @default(uuid()) @db.Uuid
  subscriptionId String        @map("subscription_id") @db.Uuid
  amountEur      Decimal       @map("amount_eur") @db.Decimal(10, 2)
  periodStart    DateTime      @map("period_start")
  periodEnd      DateTime      @map("period_end")
  status         InvoiceStatus @default(OPEN)
  paidAt         DateTime?     @map("paid_at")
  subscription   Subscription  @relation(fields: [subscriptionId], references: [id])

  @@map("invoices")
}

model OtpCode {
  id         String    @id @default(uuid()) @db.Uuid
  phone      String
  codeHash   String    @map("code_hash")
  expiresAt  DateTime  @map("expires_at")
  attempts   Int       @default(0)
  consumedAt DateTime? @map("consumed_at")
  requestIp  String?   @map("request_ip")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@index([phone])
  @@map("otp_codes")
}

model Notification {
  id          String              @id @default(uuid()) @db.Uuid
  clinicId    String?             @map("clinic_id") @db.Uuid
  channel     NotificationChannel
  recipient   String
  template    String
  payload     Json
  scheduledAt DateTime            @map("scheduled_at")
  sentAt      DateTime?           @map("sent_at")
  status      NotificationStatus  @default(SCHEDULED)
  providerRef String?             @map("provider_ref")
  clinic      Clinic?             @relation(fields: [clinicId], references: [id])

  @@map("notifications")
}
```

- [ ] **Step 2: Run the init migration**

```powershell
npx prisma migrate dev --name init
```

Expected: migration created and applied; client generated.

- [ ] **Step 3: Create `src/lib/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDirect?: PrismaClient;
};

/** RLS-enforced app connection. All request-path code uses this. */
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

/** Superuser connection. ONLY for migrations-adjacent tooling, seeds, tests. */
export const prismaDirect =
  globalForPrisma.prismaDirect ??
  new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDirect = prismaDirect;
}
```

- [ ] **Step 4: Verify client generation compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: add Prisma schema for all core entities and init migration"
```

---

### Task 3: RLS policies, helper functions, and booking exclusion constraint

**Files:**
- Migration: `prisma/migrations/<ts>_rls/migration.sql` (hand-written)

- [ ] **Step 1: Create an empty migration**

```powershell
npx prisma migrate dev --create-only --name rls
```

Expected: empty `migration.sql` created under `prisma/migrations/<ts>_rls/`.

- [ ] **Step 2: Write the migration SQL** (replace file contents)

```sql
-- === Extensions ===
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- === Session-context helper functions ===
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'public')
$$;

-- === Double-booking guard (spec §6): one dentist, no overlapping active appts ===
ALTER TABLE appointments ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    membership_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));

-- === Enable RLS on tenant/user data ===
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE dentist_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- otp_codes: auth-layer table, not tenant data; guarded by the 'auth' context.
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- === Policies ===
-- Roles used in app.role: 'public' | 'patient' | 'staff' | 'admin' | 'auth'

-- users: self, admin, auth flows (user creation on OTP verify),
-- and staff may see patients who have an appointment at their clinic.
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app_user_id()
  OR app_role() IN ('admin', 'auth')
  OR (app_role() = 'staff' AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_user_id = users.id
          AND a.clinic_id = app_clinic_id()))
);
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_role() IN ('auth', 'admin'));
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = app_user_id() OR app_role() IN ('admin', 'auth'));

-- clinics: everyone sees published; staff their own; admin all.
CREATE POLICY clinics_select ON clinics FOR SELECT USING (
  published = true OR id = app_clinic_id() OR app_role() = 'admin'
);
CREATE POLICY clinics_insert ON clinics FOR INSERT
  WITH CHECK (app_role() IN ('staff', 'admin', 'auth'));
CREATE POLICY clinics_update ON clinics FOR UPDATE
  USING (id = app_clinic_id() OR app_role() = 'admin');

-- memberships: own rows, own clinic's rows, dentists of published clinics
-- (marketplace profiles), admin.
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  user_id = app_user_id()
  OR clinic_id = app_clinic_id()
  OR app_role() IN ('admin', 'auth')
  OR EXISTS (SELECT 1 FROM clinics c
             WHERE c.id = memberships.clinic_id AND c.published = true)
);
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

-- services / dentist_services / schedules / schedule_exceptions:
-- readable when the owning clinic is published, plus own tenant + admin.
CREATE POLICY services_select ON services FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR app_role() = 'admin'
  OR EXISTS (SELECT 1 FROM clinics c WHERE c.id = services.clinic_id AND c.published = true)
);
CREATE POLICY services_write ON services FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

CREATE POLICY dentist_services_select ON dentist_services FOR SELECT USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.id = dentist_services.membership_id)
);
CREATE POLICY dentist_services_write ON dentist_services FOR ALL
  USING (EXISTS (SELECT 1 FROM memberships m
                 WHERE m.id = dentist_services.membership_id
                   AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM memberships m
                      WHERE m.id = dentist_services.membership_id
                        AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')));

CREATE POLICY schedules_select ON schedules FOR SELECT USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.id = schedules.membership_id)
);
CREATE POLICY schedules_write ON schedules FOR ALL
  USING (EXISTS (SELECT 1 FROM memberships m
                 WHERE m.id = schedules.membership_id
                   AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM memberships m
                      WHERE m.id = schedules.membership_id
                        AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')));

CREATE POLICY schedule_exceptions_select ON schedule_exceptions FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR app_role() = 'admin'
  OR EXISTS (SELECT 1 FROM clinics c
             WHERE c.id = schedule_exceptions.clinic_id AND c.published = true)
);
CREATE POLICY schedule_exceptions_write ON schedule_exceptions FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

-- appointments: tenant staff, the patient themself, admin. Patients create
-- their own; the 'auth'/booking path also inserts as patient context.
CREATE POLICY appointments_select ON appointments FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() = 'admin'
);
CREATE POLICY appointments_insert ON appointments FOR INSERT WITH CHECK (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() = 'admin'
);
CREATE POLICY appointments_update ON appointments FOR UPDATE USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() = 'admin'
);

-- reviews: published readable by all; author and tenant see their own; admin all.
CREATE POLICY reviews_select ON reviews FOR SELECT USING (
  status = 'PUBLISHED'
  OR patient_user_id = app_user_id()
  OR clinic_id = app_clinic_id()
  OR app_role() = 'admin'
);
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (patient_user_id = app_user_id() OR app_role() = 'admin');
CREATE POLICY reviews_update ON reviews FOR UPDATE
  USING (app_role() = 'admin');

-- payments / subscriptions / invoices: tenant + admin only.
CREATE POLICY payments_all ON payments FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin'
         OR EXISTS (SELECT 1 FROM appointments a
                    WHERE a.id = payments.appointment_id
                      AND a.patient_user_id = app_user_id()))
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin'
              OR EXISTS (SELECT 1 FROM appointments a
                         WHERE a.id = payments.appointment_id
                           AND a.patient_user_id = app_user_id()));

CREATE POLICY subscriptions_all ON subscriptions FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

CREATE POLICY invoices_all ON invoices FOR ALL
  USING (app_role() = 'admin' OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = invoices.subscription_id AND s.clinic_id = app_clinic_id()))
  WITH CHECK (app_role() = 'admin' OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = invoices.subscription_id AND s.clinic_id = app_clinic_id()));

-- notifications: system-managed via worker (admin/auth) + tenant reads own.
CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth')
);
CREATE POLICY notifications_write ON notifications FOR ALL
  USING (app_role() IN ('admin', 'auth') OR clinic_id = app_clinic_id())
  WITH CHECK (app_role() IN ('admin', 'auth') OR clinic_id = app_clinic_id());

-- otp_codes: only the auth context touches these.
CREATE POLICY otp_codes_all ON otp_codes FOR ALL
  USING (app_role() = 'auth')
  WITH CHECK (app_role() = 'auth');
```

- [ ] **Step 3: Apply it**

```powershell
npx prisma migrate dev
```

Expected: `rls` migration applied without error.

- [ ] **Step 4: Smoke-check RLS is live** (as app role, no context set → public)

```powershell
docker compose exec postgres psql -U dentbook_app -d dentbook -c "SELECT count(*) FROM clinics;"
```

Expected: `0` (no error — policies active, no published rows yet).

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: add RLS policies, session helpers, and double-booking exclusion constraint"
```

---

### Task 4: Tenant context helper + RLS isolation proof tests

**Files:**
- Create: `src/lib/tenant-db.ts`, `tests/helpers/global-setup.ts`, `tests/helpers/setup-env.ts`, `tests/helpers/db.ts`, `tests/rls-isolation.test.ts`

- [ ] **Step 1: Create `src/lib/tenant-db.ts`**

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type AppRole = "public" | "patient" | "staff" | "admin" | "auth";

export interface DbContext {
  role: AppRole;
  userId?: string;
  clinicId?: string;
}

/**
 * Runs `fn` in a transaction whose RLS session variables are set from `ctx`.
 * ALL request-path database access must go through this.
 */
export async function withDbContext<T>(
  ctx: DbContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.role', ${ctx.role}, true),
             set_config('app.user_id', ${ctx.userId ?? ""}, true),
             set_config('app.clinic_id', ${ctx.clinicId ?? ""}, true)
    `;
    return fn(tx);
  });
}
```

- [ ] **Step 2: Create `tests/helpers/global-setup.ts`** (migrates the test DB once per run)

```ts
import { execSync } from "node:child_process";
import "dotenv/config";

export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DIRECT_DATABASE_URL,
      DIRECT_DATABASE_URL: process.env.TEST_DIRECT_DATABASE_URL,
    },
  });
}
```

- [ ] **Step 3: Create `tests/helpers/setup-env.ts`** (setupFiles run before test-file imports, so the app's Prisma client — constructed at import time — picks up the test DB)

```ts
import "dotenv/config";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL;
```

- [ ] **Step 4: Create `tests/helpers/db.ts`**

```ts
import { PrismaClient, Prisma } from "@prisma/client";
import "dotenv/config";

/** Superuser client for arranging fixtures (bypasses RLS). */
export const direct = new PrismaClient({
  datasourceUrl: process.env.TEST_DIRECT_DATABASE_URL,
});

/** RLS-enforced client (dentbook_app role) — the system under test. */
export const app = new PrismaClient({
  datasourceUrl: process.env.TEST_DATABASE_URL,
});

export type AppRole = "public" | "patient" | "staff" | "admin" | "auth";

/** Test twin of withDbContext, bound to the test app client. */
export async function asContext<T>(
  ctx: { role: AppRole; userId?: string; clinicId?: string },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.role', ${ctx.role}, true),
             set_config('app.user_id', ${ctx.userId ?? ""}, true),
             set_config('app.clinic_id', ${ctx.clinicId ?? ""}, true)
    `;
    return fn(tx);
  });
}

/** Wipes all data between test files. */
export async function truncateAll() {
  await direct.$executeRawUnsafe(`
    TRUNCATE TABLE notifications, otp_codes, invoices, subscriptions, payments,
      reviews, appointments, schedule_exceptions, schedules, dentist_services,
      services, memberships, clinics, users CASCADE
  `);
}
```

- [ ] **Step 5: Write the failing isolation tests — `tests/rls-isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, app, asContext, truncateAll } from "./helpers/db";

let clinicA: string, clinicB: string;
let staffA: string, patientX: string;
let dentistMembershipA: string;

beforeAll(async () => {
  await truncateAll();
  const a = await direct.clinic.create({
    data: { slug: "klinika-a", name: "Klinika A", city: "Prishtinë",
            address: "Rr. A 1", phone: "+38344111111", published: true },
  });
  const b = await direct.clinic.create({
    data: { slug: "klinika-b", name: "Klinika B", city: "Prizren",
            address: "Rr. B 2", phone: "+38344222222", published: false },
  });
  clinicA = a.id; clinicB = b.id;

  const ua = await direct.user.create({
    data: { name: "Staff A", email: "staff@a.com", passwordHash: "x" },
  });
  staffA = ua.id;
  await direct.membership.create({
    data: { userId: staffA, clinicId: clinicA, role: "OWNER" },
  });

  // one dentist per clinic (separate users — user+clinic is unique)
  const drA = await direct.user.create({ data: { name: "Dr A", email: "dr@a.com" } });
  const mA = await direct.membership.create({
    data: { userId: drA.id, clinicId: clinicA, role: "DENTIST" },
  });
  dentistMembershipA = mA.id;
  const drB = await direct.user.create({ data: { name: "Dr B", email: "dr@b.com" } });
  const mB = await direct.membership.create({
    data: { userId: drB.id, clinicId: clinicB, role: "DENTIST" },
  });

  const svcA = await direct.service.create({
    data: { clinicId: clinicA, nameSq: "Pastrim", nameEn: "Cleaning",
            durationMin: 30, priceEur: 25 },
  });
  const svcB = await direct.service.create({
    data: { clinicId: clinicB, nameSq: "Kontroll", nameEn: "Check-up",
            durationMin: 30, priceEur: 20 },
  });

  const px = await direct.user.create({
    data: { name: "Pacienti X", phone: "+38344999999" },
  });
  patientX = px.id;

  // the same patient has one appointment in EACH clinic
  await direct.appointment.create({
    data: { clinicId: clinicA, membershipId: mA.id,
            patientUserId: patientX, serviceId: svcA.id,
            startsAt: new Date("2026-08-01T09:00:00Z"),
            endsAt: new Date("2026-08-01T09:30:00Z"), status: "CONFIRMED" },
  });
  await direct.appointment.create({
    data: { clinicId: clinicB, membershipId: mB.id,
            patientUserId: patientX, serviceId: svcB.id,
            startsAt: new Date("2026-08-02T10:00:00Z"),
            endsAt: new Date("2026-08-02T10:30:00Z"), status: "CONFIRMED" },
  });
});

afterAll(async () => {
  await app.$disconnect();
  await direct.$disconnect();
});

describe("RLS tenant isolation", () => {
  it("staff of clinic A cannot read clinic B (unpublished)", async () => {
    const rows = await asContext(
      { role: "staff", userId: staffA, clinicId: clinicA },
      (tx) => tx.clinic.findMany(),
    );
    expect(rows.map((c) => c.id)).toContain(clinicA);
    expect(rows.map((c) => c.id)).not.toContain(clinicB);
  });

  it("staff of clinic A cannot update clinic B", async () => {
    const res = await asContext(
      { role: "staff", userId: staffA, clinicId: clinicA },
      (tx) => tx.clinic.updateMany({
        where: { id: clinicB }, data: { name: "HACKED" } }),
    );
    expect(res.count).toBe(0);
    const b = await direct.clinic.findUnique({ where: { id: clinicB } });
    expect(b!.name).toBe("Klinika B");
  });

  it("staff of clinic A sees only their clinic's appointments (1 of 2)", async () => {
    const rows = await asContext(
      { role: "staff", userId: staffA, clinicId: clinicA },
      (tx) => tx.appointment.findMany(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].clinicId).toBe(clinicA);
  });

  it("anonymous (public) sees only published clinics", async () => {
    const rows = await asContext({ role: "public" }, (tx) => tx.clinic.findMany());
    expect(rows.map((c) => c.id)).toEqual([clinicA]);
  });

  it("public cannot read appointments at all", async () => {
    const rows = await asContext({ role: "public" }, (tx) => tx.appointment.findMany());
    expect(rows).toEqual([]);
  });

  it("patient sees own appointments across clinics but not other users", async () => {
    const appts = await asContext(
      { role: "patient", userId: patientX },
      (tx) => tx.appointment.findMany(),
    );
    expect(appts.length).toBe(2);
    const users = await asContext(
      { role: "patient", userId: patientX },
      (tx) => tx.user.findMany(),
    );
    expect(users.map((u) => u.id)).toEqual([patientX]);
  });

  it("admin sees everything", async () => {
    const rows = await asContext({ role: "admin" }, (tx) => tx.clinic.findMany());
    expect(rows.length).toBe(2);
  });

  it("double-booking the same dentist slot is rejected by the DB", async () => {
    const appt = await direct.appointment.findFirstOrThrow({
      where: { membershipId: dentistMembershipA },
    });
    await expect(
      direct.appointment.create({
        data: {
          clinicId: appt.clinicId, membershipId: dentistMembershipA,
          patientUserId: patientX, serviceId: appt.serviceId,
          startsAt: new Date("2026-08-01T09:15:00Z"), // overlaps 09:00–09:30
          endsAt: new Date("2026-08-01T09:45:00Z"), status: "CONFIRMED",
        },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run tests — expect failures only if policies are wrong**

```powershell
npm run test -- tests/rls-isolation.test.ts
```

Expected: all 8 tests PASS (the "failing test" phase here validates the policies written in Task 3; if any fail, fix the policy SQL with a new migration, not the test).

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat: tenant context helper and RLS isolation proof tests"
```

---

### Task 5: OTP service with rate limiting + SMS provider abstraction

**Files:**
- Create: `src/lib/sms/types.ts`, `src/lib/sms/console.ts`, `src/lib/sms/index.ts`, `src/lib/otp.ts`, `tests/otp.test.ts`

- [ ] **Step 1: Create the SMS provider interface — `src/lib/sms/types.ts`**

```ts
export interface SmsProvider {
  send(to: string, message: string): Promise<{ providerRef: string }>;
}
```

- [ ] **Step 2: Create `src/lib/sms/console.ts`**

```ts
import type { SmsProvider } from "./types";

/** Dev/test provider: prints the SMS to stdout. */
export class ConsoleSmsProvider implements SmsProvider {
  async send(to: string, message: string) {
    console.log(`[SMS → ${to}] ${message}`);
    return { providerRef: `console-${Date.now()}` };
  }
}
```

- [ ] **Step 3: Create `src/lib/sms/index.ts`**

```ts
import type { SmsProvider } from "./types";
import { ConsoleSmsProvider } from "./console";

export function getSmsProvider(): SmsProvider {
  switch (process.env.SMS_PROVIDER) {
    case "console":
    default:
      return new ConsoleSmsProvider(); // Twilio provider arrives in Plan 3
  }
}
export type { SmsProvider };
```

- [ ] **Step 4: Write failing tests — `tests/otp.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { requestOtp, verifyOtp, OtpError } from "@/lib/otp";
// (setup-env.ts already pointed DATABASE_URL at the test DB before imports)

const PHONE = "+38344123456";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await direct.$disconnect();
});

describe("requestOtp", () => {
  it("stores a hashed 6-digit code and returns nothing sensitive", async () => {
    const res = await requestOtp(PHONE, "1.2.3.4");
    expect(res).toEqual({ ok: true });
    const row = await direct.otpCode.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex, never plaintext
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a 4th request for the same phone within 15 minutes", async () => {
    await requestOtp(PHONE, "1.2.3.4");
    await requestOtp(PHONE, "1.2.3.4");
    await requestOtp(PHONE, "1.2.3.4");
    await expect(requestOtp(PHONE, "1.2.3.4")).rejects.toThrow(OtpError);
  });

  it("rejects an 11th request from the same IP within an hour", async () => {
    for (let i = 0; i < 10; i++) {
      await requestOtp(`+3834400000${i}`, "9.9.9.9");
    }
    await expect(requestOtp("+38344999998", "9.9.9.9")).rejects.toThrow(OtpError);
  });
});

describe("verifyOtp", () => {
  it("verifies the right code, creates the user, consumes the code", async () => {
    const code = await requestOtpReturningCode(PHONE);
    const user = await verifyOtp(PHONE, code, "Pacienti Test");
    expect(user.phone).toBe(PHONE);
    expect(user.name).toBe("Pacienti Test");
    // consumed: same code fails second time
    await expect(verifyOtp(PHONE, code, "X")).rejects.toThrow(OtpError);
  });

  it("re-verifying an existing phone returns the same user", async () => {
    const c1 = await requestOtpReturningCode(PHONE);
    const u1 = await verifyOtp(PHONE, c1, "Pacienti");
    const c2 = await requestOtpReturningCode(PHONE);
    const u2 = await verifyOtp(PHONE, c2, "Ignored");
    expect(u2.id).toBe(u1.id);
  });

  it("rejects a wrong code and blocks after 5 attempts", async () => {
    const code = await requestOtpReturningCode(PHONE);
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(PHONE, "000000", "X")).rejects.toThrow(OtpError);
    }
    // even the correct code is now rejected
    await expect(verifyOtp(PHONE, code, "X")).rejects.toThrow(OtpError);
  });

  it("rejects an expired code", async () => {
    const code = await requestOtpReturningCode(PHONE);
    await direct.otpCode.updateMany({
      where: { phone: PHONE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(verifyOtp(PHONE, code, "X")).rejects.toThrow(OtpError);
  });
});

/** Requests an OTP and extracts the code from the console provider's stdout. */
async function requestOtpReturningCode(phone: string): Promise<string> {
  const spy = vi.spyOn(console, "log");
  await requestOtp(phone, "1.2.3.4");
  const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes(phone));
  spy.mockRestore();
  const m = line?.match(/\b(\d{6})\b/);
  if (!m) throw new Error("no OTP code logged");
  return m[1];
}
```

- [ ] **Step 5: Run tests to verify they fail**

```powershell
npm run test -- tests/otp.test.ts
```

Expected: FAIL — `@/lib/otp` does not exist.

- [ ] **Step 6: Implement `src/lib/otp.ts`**

```ts
import { createHash, randomInt } from "node:crypto";
import { withDbContext } from "./tenant-db";
import { getSmsProvider } from "./sms";

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_PER_PHONE_15MIN = 3;
const MAX_PER_IP_HOUR = 10;
const MAX_VERIFY_ATTEMPTS = 5;

export class OtpError extends Error {
  constructor(public code:
    | "RATE_LIMITED_PHONE" | "RATE_LIMITED_IP"
    | "INVALID_CODE" | "EXPIRED" | "TOO_MANY_ATTEMPTS") {
    super(code);
  }
}

function hashCode(phone: string, code: string): string {
  return createHash("sha256")
    .update(`${phone}:${code}:${process.env.OTP_PEPPER}`)
    .digest("hex");
}

export async function requestOtp(phone: string, ip: string): Promise<{ ok: true }> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await withDbContext({ role: "auth" }, async (tx) => {
    const since15 = new Date(Date.now() - 15 * 60 * 1000);
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000);
    const [byPhone, byIp] = await Promise.all([
      tx.otpCode.count({ where: { phone, createdAt: { gte: since15 } } }),
      tx.otpCode.count({ where: { requestIp: ip, createdAt: { gte: sinceHour } } }),
    ]);
    if (byPhone >= MAX_PER_PHONE_15MIN) throw new OtpError("RATE_LIMITED_PHONE");
    if (byIp >= MAX_PER_IP_HOUR) throw new OtpError("RATE_LIMITED_IP");
    await tx.otpCode.create({
      data: {
        phone,
        codeHash: hashCode(phone, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        requestIp: ip,
      },
    });
  });
  await getSmsProvider().send(phone, `Dentbook: kodi juaj është ${code}`);
  return { ok: true };
}

export async function verifyOtp(phone: string, code: string, name: string) {
  return withDbContext({ role: "auth" }, async (tx) => {
    const otp = await tx.otpCode.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new OtpError("INVALID_CODE");
    if (otp.attempts >= MAX_VERIFY_ATTEMPTS) throw new OtpError("TOO_MANY_ATTEMPTS");
    if (otp.expiresAt < new Date()) throw new OtpError("EXPIRED");
    if (otp.codeHash !== hashCode(phone, code)) {
      await tx.otpCode.update({
        where: { id: otp.id }, data: { attempts: { increment: 1 } },
      });
      throw new OtpError("INVALID_CODE");
    }
    await tx.otpCode.update({
      where: { id: otp.id }, data: { consumedAt: new Date() },
    });
    const existing = await tx.user.findUnique({ where: { phone } });
    if (existing) return existing;
    return tx.user.create({ data: { phone, name } });
  });
}
```

- [ ] **Step 7: Run tests to verify they pass**

```powershell
npm run test -- tests/otp.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "feat: phone OTP service with rate limiting and SMS provider abstraction"
```

---

### Task 6: Staff password auth + Auth.js wiring

**Files:**
- Create: `src/lib/staff-auth.ts`, `tests/staff-auth.test.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts` (the login *page* is built in Task 7 after i18n exists)

- [ ] **Step 1: Write failing tests — `tests/staff-auth.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { hashPassword, verifyStaffLogin } from "@/lib/staff-auth";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await direct.$disconnect();
});

describe("staff login", () => {
  it("returns the user for correct email+password", async () => {
    await direct.user.create({
      data: { name: "Owner", email: "owner@klinika.com",
              passwordHash: await hashPassword("sekret123") },
    });
    const user = await verifyStaffLogin("owner@klinika.com", "sekret123");
    expect(user?.email).toBe("owner@klinika.com");
  });

  it("returns null for wrong password", async () => {
    await direct.user.create({
      data: { name: "Owner", email: "owner@klinika.com",
              passwordHash: await hashPassword("sekret123") },
    });
    expect(await verifyStaffLogin("owner@klinika.com", "gabim")).toBeNull();
  });

  it("returns null for unknown email and for passwordless (patient) users", async () => {
    await direct.user.create({
      data: { name: "Pacient", email: "p@x.com", phone: "+38344000001" },
    });
    expect(await verifyStaffLogin("nuk@ekziston.com", "x")).toBeNull();
    expect(await verifyStaffLogin("p@x.com", "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
npm run test -- tests/staff-auth.test.ts
```

Expected: FAIL — `@/lib/staff-auth` does not exist.

- [ ] **Step 3: Implement `src/lib/staff-auth.ts`**

```ts
import bcrypt from "bcryptjs";
import { withDbContext } from "./tenant-db";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyStaffLogin(email: string, password: string) {
  return withDbContext({ role: "auth" }, async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
npm run test -- tests/staff-auth.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Create `src/auth.ts`** (Auth.js v5, JWT sessions, two providers)

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { verifyOtp } from "@/lib/otp";
import { verifyStaffLogin } from "@/lib/staff-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      id: "patient-otp",
      credentials: { phone: {}, code: {}, name: {} },
      async authorize(creds) {
        const parsed = z.object({
          phone: z.string().min(8),
          code: z.string().length(6),
          name: z.string().min(1),
        }).safeParse(creds);
        if (!parsed.success) return null;
        try {
          const user = await verifyOtp(
            parsed.data.phone, parsed.data.code, parsed.data.name);
          return { id: user.id, name: user.name,
                   isPlatformAdmin: user.isPlatformAdmin, kind: "patient" };
        } catch {
          return null;
        }
      },
    }),
    Credentials({
      id: "staff-login",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const parsed = z.object({
          email: z.string().email(),
          password: z.string().min(1),
        }).safeParse(creds);
        if (!parsed.success) return null;
        const user = await verifyStaffLogin(
          parsed.data.email, parsed.data.password);
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email,
                 isPlatformAdmin: user.isPlatformAdmin, kind: "staff" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.kind = (user as { kind: string }).kind;
        token.isPlatformAdmin =
          (user as { isPlatformAdmin: boolean }).isPlatformAdmin;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.kind = token.kind as "patient" | "staff";
      session.user.isPlatformAdmin = token.isPlatformAdmin as boolean;
      return session;
    },
  },
});
```

- [ ] **Step 6: Create `src/types/next-auth.d.ts`**

```ts
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      kind: "patient" | "staff";
      isPlatformAdmin: boolean;
    };
  }
}
```

- [ ] **Step 7: Create `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 8: Type-check and run full suite**

```powershell
npx tsc --noEmit
npm run test
```

Expected: no type errors; all tests PASS.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: staff password auth and Auth.js wiring with patient OTP + staff providers"
```

---

### Task 7: i18n (next-intl) — Albanian default, English secondary + minimal shell UI

**Files:**
- Create: `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/middleware.ts`, `src/messages/sq.json`, `src/messages/en.json`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`, `src/app/[locale]/login/page.tsx`
- Modify: `next.config.ts` (next-intl plugin)
- Delete: `src/app/page.tsx`, `src/app/layout.tsx` (replaced by `[locale]` tree; keep `globals.css` import in the new layout)

- [ ] **Step 1: Create `src/i18n/routing.ts`**

```ts
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["sq", "en"],
  defaultLocale: "sq",
  localePrefix: "as-needed", // / = Albanian, /en/... = English
});
```

- [ ] **Step 2: Create `src/i18n/request.ts`**

```ts
import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 3: Create `src/middleware.ts`**

```ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // everything except api, static files, images
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
```

- [ ] **Step 4: Wire the plugin in `next.config.ts`**

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
```

- [ ] **Step 5: Create message files**

`src/messages/sq.json`:

```json
{
  "Home": {
    "title": "Gjej dentistin tënd në Kosovë",
    "subtitle": "Krahaso klinikat, shiko oraret e lira dhe rezervo online.",
    "cta": "Kërko klinika"
  },
  "Login": {
    "staffTitle": "Hyrja për klinika",
    "email": "Email",
    "password": "Fjalëkalimi",
    "submit": "Hyr",
    "error": "Email ose fjalëkalim i gabuar"
  },
  "Common": {
    "appName": "Dentbook"
  }
}
```

`src/messages/en.json`:

```json
{
  "Home": {
    "title": "Find your dentist in Kosovo",
    "subtitle": "Compare clinics, see open slots, and book online.",
    "cta": "Browse clinics"
  },
  "Login": {
    "staffTitle": "Clinic sign-in",
    "email": "Email",
    "password": "Password",
    "submit": "Sign in",
    "error": "Wrong email or password"
  },
  "Common": {
    "appName": "Dentbook"
  }
}
```

- [ ] **Step 6: Move the app tree under `[locale]`**

`src/app/[locale]/layout.tsx`:

```tsx
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`src/app/[locale]/page.tsx`:

```tsx
import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("Home");
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="text-lg text-gray-600">{t("subtitle")}</p>
      <a href="#" className="rounded-lg bg-sky-600 px-6 py-3 text-white">
        {t("cta")}
      </a>
    </main>
  );
}
```

Delete the old `src/app/page.tsx` and `src/app/layout.tsx`. Keep `src/app/globals.css`.

- [ ] **Step 7: Staff login page — `src/app/[locale]/login/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const t = await getTranslations("Login");

  async function loginAction(formData: FormData) {
    "use server";
    try {
      await signIn("staff-login", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
    } catch {
      redirect("/login?error=1");
    }
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t("staffTitle")}</h1>
      <form action={loginAction} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder={t("email")}
               className="rounded border p-2" />
        <input name="password" type="password" required placeholder={t("password")}
               className="rounded border p-2" />
        <button type="submit" className="rounded bg-sky-600 p-2 text-white">
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Verify build + dev smoke test**

```powershell
npm run build
```

Expected: build succeeds. Then `npm run dev`, open `http://localhost:3000` → Albanian homepage; `http://localhost:3000/en` → English; `http://localhost:3000/login` renders the form.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: Albanian/English i18n with next-intl, localized home and staff login pages"
```

---

### Task 8: Seed script + final verification

**Files:**
- Create: `prisma/seed.ts`

- [ ] **Step 1: Write `prisma/seed.ts`** (uses the direct client — seeding bypasses RLS)

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function main() {
  const pw = await bcrypt.hash("demo1234", 10);

  await db.user.upsert({
    where: { email: "admin@dentbook.dev" },
    update: {},
    create: { name: "Platform Admin", email: "admin@dentbook.dev",
              passwordHash: pw, isPlatformAdmin: true },
  });

  const clinics = [
    { slug: "klinika-arta", name: "Klinika Dentare Arta", city: "Prishtinë",
      address: "Rr. Nëna Terezë 12", phone: "+38344100100", published: true,
      owner: { name: "Arta Berisha", email: "arta@klinika-arta.dev" },
      dentists: [{ name: "Dr. Blerim Gashi", email: "blerim@klinika-arta.dev",
                   title: "Dr. med. dent." }] },
    { slug: "dental-prizren", name: "Dental Center Prizren", city: "Prizren",
      address: "Rr. Adem Jashari 5", phone: "+38344200200", published: true,
      owner: { name: "Fatos Krasniqi", email: "fatos@dental-prizren.dev" },
      dentists: [{ name: "Dr. Vjosa Hoti", email: "vjosa@dental-prizren.dev",
                   title: "Dr. med. dent." }] },
    { slug: "smile-peja", name: "Smile Clinic Peja", city: "Pejë",
      address: "Rr. Haxhi Zeka 3", phone: "+38344300300", published: false,
      owner: { name: "Erza Morina", email: "erza@smile-peja.dev" },
      dentists: [] },
  ];

  for (const c of clinics) {
    const clinic = await db.clinic.upsert({
      where: { slug: c.slug },
      update: {},
      create: { slug: c.slug, name: c.name, city: c.city, address: c.address,
                phone: c.phone, published: c.published,
                approvedAt: c.published ? new Date() : null },
    });

    await db.subscription.upsert({
      where: { clinicId: clinic.id },
      update: {},
      create: { clinicId: clinic.id, plan: "TRIAL", status: "ACTIVE",
                trialEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    });

    const owner = await db.user.upsert({
      where: { email: c.owner.email },
      update: {},
      create: { name: c.owner.name, email: c.owner.email, passwordHash: pw },
    });
    await db.membership.upsert({
      where: { userId_clinicId: { userId: owner.id, clinicId: clinic.id } },
      update: {},
      create: { userId: owner.id, clinicId: clinic.id, role: "OWNER" },
    });

    const services = await Promise.all([
      db.service.create({
        data: { clinicId: clinic.id, nameSq: "Kontroll dhe konsultë",
                nameEn: "Check-up & consultation", durationMin: 30, priceEur: 20 } }),
      db.service.create({
        data: { clinicId: clinic.id, nameSq: "Pastrim dhëmbësh",
                nameEn: "Teeth cleaning", durationMin: 45, priceEur: 35 } }),
      db.service.create({
        data: { clinicId: clinic.id, nameSq: "Mbushje dhëmbi",
                nameEn: "Tooth filling", durationMin: 60, priceEur: 40,
                depositEur: 10 } }),
    ]);

    for (const d of c.dentists) {
      const du = await db.user.upsert({
        where: { email: d.email },
        update: {},
        create: { name: d.name, email: d.email, passwordHash: pw },
      });
      const m = await db.membership.upsert({
        where: { userId_clinicId: { userId: du.id, clinicId: clinic.id } },
        update: {},
        create: { userId: du.id, clinicId: clinic.id, role: "DENTIST",
                  title: d.title },
      });
      for (const s of services) {
        await db.dentistService.upsert({
          where: { membershipId_serviceId: { membershipId: m.id, serviceId: s.id } },
          update: {},
          create: { membershipId: m.id, serviceId: s.id },
        });
      }
      // Mon–Fri 09:00–17:00
      for (const weekday of [1, 2, 3, 4, 5]) {
        await db.schedule.create({
          data: { membershipId: m.id, weekday, startMin: 9 * 60, endMin: 17 * 60 },
        });
      }
    }
  }

  console.log("Seed complete. Staff password for all demo users: demo1234");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
```

Note: seed uses `create` (not upsert) for services/schedules, so it is idempotent only for users/clinics/memberships. Acceptable for dev; re-running against a dirty DB duplicates services. Reset with `npx prisma migrate reset` when needed.

- [ ] **Step 2: Run the seed**

```powershell
npm run db:seed
```

Expected: "Seed complete." printed; no errors.

- [ ] **Step 3: Verify seeded data respects RLS from the app role**

```powershell
docker compose exec postgres psql -U dentbook_app -d dentbook -c "SELECT slug FROM clinics;"
```

Expected: exactly `klinika-arta` and `dental-prizren` (the unpublished `smile-peja` is invisible to the public context).

- [ ] **Step 4: Full final verification**

```powershell
npm run test
npm run build
```

Expected: all tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: seed script with demo clinics, staff, services, and schedules"
```

---

## Phase 1 exit criteria

- `npm run test` — RLS isolation, OTP, and staff-auth suites all green
- `npm run build` — clean production build
- `npm run dev` — Albanian home at `/`, English at `/en`, staff login form at `/login` (works against seeded `demo1234` accounts)
- Database provably refuses: cross-tenant reads/writes, unpublished-clinic leaks, double-booked dentist slots
