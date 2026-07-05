# Dentbook — Multi-tenant Dental Booking Platform for Kosovo

**Date:** 2026-07-05
**Status:** Approved design
**Working name:** Dentbook (placeholder — renaming is cosmetic and does not affect the architecture)

## 1. Purpose

A production SaaS platform where patients in Kosovo find dentists and book
appointments online, and dental clinics manage their calendars, staff, and
services. Each clinic is a tenant. The business model is clinic subscriptions.

Success criteria for v1:

- A patient can find a clinic, book a verified appointment, and receive
  SMS/email confirmations and reminders — in Albanian or English.
- A clinic can self-onboard, configure staff/services/hours, and run its
  daily appointment flow entirely from the dashboard.
- The platform owner can approve clinics, manage subscriptions (manual
  invoicing), and moderate reviews.
- No clinic can ever read or write another clinic's data (enforced at the
  database level, proven by tests).

## 2. Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Product type | Real product / startup |
| Tenant exposure | Marketplace **and** branded per-clinic subdomain pages |
| V1 features | SMS confirmations/reminders, reviews & ratings, deposits, clinic subscription billing |
| Payments | Payment-ready: full flows behind a provider interface with a mock provider; real gateway (local bank or Stripe-via-foreign-entity) integrated later. Stripe/Paddle/PayPal are unavailable to Kosovo-registered merchants. |
| Stack | Next.js (App Router) + TypeScript, monolith |
| Database | PostgreSQL, shared schema + Row-Level Security |
| Languages | Albanian (default) + English; i18n infra makes Serbian a translation-file task later |
| Patient auth | Phone OTP; account created implicitly; no password required |
| Booking confirmation | Per-clinic toggle: instant confirmation or request-then-approve |
| Architecture | Single Next.js app + pg-boss worker + Postgres (no Redis) |

## 3. Surfaces & roles

One Next.js app, four surfaces, resolved by middleware from hostname/path:

| Surface | URL | Audience |
|---|---|---|
| Marketplace | `www.<domain>` | Patients: search by city/service, compare clinics, book |
| Branded clinic page | `{clinic-slug}.<domain>` | Patients of one clinic: profile + booking with clinic logo/colors |
| Clinic dashboard | `www.<domain>/dashboard` | Clinic staff |
| Platform admin | `www.<domain>/admin` | Platform owner |

Roles:

- **Patient** — phone-OTP identity, platform-wide (not per-clinic).
- **Clinic staff** — a user with a membership in a clinic, role one of
  `OWNER`, `DENTIST`, `RECEPTIONIST`. A user may have memberships in
  multiple clinics.
- **Platform admin** — global role on the user record.

A clinic = one tenant = one physical location. A chain registers multiple
clinics (multi-location accounts are out of scope for v1).

## 4. Stack

- **Next.js** (App Router, server components) + **TypeScript**
- **Tailwind CSS + shadcn/ui** for UI
- **Prisma + PostgreSQL** — shared schema, RLS enforced
- **next-intl** — `sq` (default), `en`; all user-facing strings in message files
- **Auth.js** — two credential flows: phone-OTP (patients), email/password (staff)
- **Zod** for validation at every boundary
- **pg-boss** for background jobs (Postgres-backed queue, no Redis):
  SMS/email dispatch, 24h reminders, review invitations, subscription
  period rollover
- **Docker Compose** deployment: `web` (Next.js), `worker` (pg-boss
  consumer), `postgres`. Wildcard DNS (`*.<domain>`) for clinic subdomains.
- Currency: **EUR**. Timezone: **Europe/Belgrade** (CET) stored per clinic.

## 5. Multi-tenancy & isolation

- Shared schema; every tenant-scoped table carries `clinic_id`.
- **Postgres RLS** is the enforcement layer. Each request runs in a
  transaction that sets session variables (`app.user_id`, `app.clinic_id`,
  `app.role`); policies filter all reads/writes. App-code bugs cannot leak
  cross-tenant data.
- The app connects as a non-superuser role subject to RLS. Policy classes:
  - **Tenant policies** — staff access rows of their clinic only.
  - **Public policies** — marketplace reads published clinics/services/
    dentist profiles/published reviews only.
  - **Patient policies** — patients read/write their own appointments,
    reviews, profile.
  - **Admin bypass** — platform admin role skips tenant filters.
- Subdomain routing: middleware parses `Host`; `www`/apex serves
  marketplace + dashboard + admin; `{slug}.<domain>` rewrites to the
  branded clinic page with tenant context.
- Cross-tenant leak tests are part of the integration suite from day one.

## 6. Data model (core tables)

- **users** — id, phone (unique, E.164), email (nullable), password_hash
  (nullable; staff only), name, locale, is_platform_admin
- **memberships** — user_id, clinic_id, role (`OWNER|DENTIST|RECEPTIONIST`);
  dentist memberships carry a public profile (title, bio, photo)
- **clinics** — slug (unique, subdomain), name, city, address, phone,
  about (sq/en), branding (logo, colors), `booking_mode`
  (`INSTANT|APPROVAL`), cancellation_window_hours, timezone, published,
  approved_at
- **services** — clinic_id, name (sq/en), duration_min, price_eur,
  deposit_eur (nullable = no deposit)
- **dentist_services** — membership_id ↔ service_id
- **schedules** — membership_id (dentist), weekday, start, end
- **schedule_exceptions** — membership_id or clinic-wide, date, closed or
  altered hours
- **appointments** — clinic_id, dentist membership_id, patient user_id,
  service_id, starts_at, ends_at, status
  (`PENDING|CONFIRMED|DECLINED|CANCELLED|COMPLETED|NO_SHOW`), notes,
  manage_token (for login-free cancel/reschedule), payment_id (nullable)
- **reviews** — clinic_id, patient user_id, appointment_id (unique),
  rating 1–5, comment, status (`PUBLISHED|HIDDEN`)
- **payments** — clinic_id, appointment_id, amount_eur, provider,
  provider_ref, status (`PENDING|SUCCEEDED|FAILED|REFUNDED`)
- **subscriptions** — clinic_id, plan (`TRIAL|BASIC|PRO`), status,
  trial_ends_at, current_period_end
- **invoices** — subscription_id, amount_eur, period, status
  (`OPEN|PAID|VOID`), paid_at; admin can mark paid (manual invoicing)
- **otp_codes** — phone, code_hash, expires_at, attempts
- **notifications** (outbox) — channel (`SMS|EMAIL`), recipient, template,
  payload, scheduled_at, sent_at, status, provider_ref

Key invariants:

- **No slot table.** Available slots are computed from schedules −
  exceptions − active appointments.
- **Double-booking is impossible** via a Postgres exclusion constraint on
  (dentist membership_id, tstzrange(starts_at, ends_at)) for active
  statuses — race-proof under concurrency.
- **Appointment status machine:** `PENDING → CONFIRMED | DECLINED`;
  `CONFIRMED → COMPLETED | CANCELLED | NO_SHOW`. Instant-mode clinics
  create appointments directly as `CONFIRMED`.
- **Reviews are verified-only:** one review per `COMPLETED` appointment.

## 7. Provider abstractions

Two swappable interfaces, each with a production-shaped mock:

- **PaymentProvider** — `createCheckout`, `handleWebhook`, `refund`.
  V1 ships `MockPaymentProvider` (succeeds after an explicit confirm step,
  so the UX flow is real). Deposit flow and subscription invoicing run
  end-to-end against it. Real gateway (Kosovo bank e-commerce or Stripe
  via foreign entity) is a later drop-in.
- **SmsProvider** — `send(to, message)`. V1 ships `TwilioSmsProvider`
  (+383 supported) and `ConsoleSmsProvider` for dev/test. A local Kosovar
  gateway can be added later.

Email goes through a similar thin `EmailProvider` (SMTP/nodemailer in v1).

## 8. Key flows

**Booking (patient):** marketplace or branded page → pick service → pick
dentist (or "any available") → pick date → server-computed free slots →
enter name + phone → OTP SMS → (if service has deposit: mock checkout) →
appointment created as `CONFIRMED` (instant mode) or `PENDING` (approval
mode) → confirmation SMS + email with tokenized manage-link → reminder SMS
24h before start.

**Approval mode (clinic):** pending requests appear in dashboard; staff
accept/decline; patient is notified by SMS either way. Pending requests
auto-expire (declined) if the slot passes.

**Cancel/reschedule:** patient uses the manage-link (no login) within the
clinic's cancellation window; staff can always cancel/reschedule from the
dashboard; all changes notify the other party.

**Clinic onboarding:** owner self-signs-up → platform admin approves →
setup wizard (profile → staff invites → services → working hours) →
publish to marketplace. Subscription starts as `TRIAL`.

**Reviews:** when an appointment is marked `COMPLETED`, a job sends an SMS
with a one-time review link; review appears on the clinic profile;
platform admin can hide abusive reviews.

**Subscriptions:** plans gate nothing critical in v1 (all features
available on trial); the machinery exists — periods, invoices, admin
"mark paid", overdue flag on the clinic. Enforcement/dunning comes with
the real payment provider.

## 9. Error handling & security

- Zod-validated input at every server boundary; localized (sq/en) error
  messages.
- OTP hardening: 6-digit codes, hashed at rest, 5-minute expiry, max 5
  verify attempts, rate limits per phone and per IP (SMS is an abuse/cost
  vector).
- RLS as the isolation backstop for every query.
- Manage-links are single-purpose random tokens, expire after the
  appointment ends.
- Kosovo's Law on Personal Data Protection mirrors GDPR: data
  minimization (no medical records in v1 — appointment notes only),
  patient data deletion support (anonymize user + keep appointment rows
  for clinic statistics).
- All SMS/email pass through the notifications outbox — auditable, safe
  to retry, idempotent sends.

## 10. Testing strategy

TDD throughout (superpowers test-driven-development skill). Priority
coverage:

1. **Slot computation** — pure function; unit tests for exceptions,
   overlaps, boundaries, timezone/DST edges.
2. **RLS isolation** — integration tests that actively attempt cross-tenant
   reads/writes as staff, patient, and anonymous roles.
3. **Booking concurrency** — parallel bookings of the same slot; exactly
   one succeeds.
4. **Status machine & policies** — appointment transitions, cancellation
   window, review eligibility.
5. **Playwright E2E** — book (instant + approval), cancel via manage-link,
   clinic onboarding wizard, leave review.

## 11. Deployment & environments

- **Local dev:** Docker Compose Postgres; `ConsoleSmsProvider`; mock
  payments; seed script creates demo clinics/dentists/appointments.
- **Production:** Docker Compose (web, worker, postgres) on any VPS;
  wildcard DNS + wildcard TLS (Caddy or certbot) for `*.<domain>`.
  No Vercel/Redis dependency.

## 12. Explicitly out of scope for v1

Native mobile app; real payment gateway (interface ready); Serbian locale
(i18n ready); custom domains per clinic (subdomains only); Google Calendar
sync; waitlists; patient medical charting; multi-location clinic accounts;
insurance integrations.
