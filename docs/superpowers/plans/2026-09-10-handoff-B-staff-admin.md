# Handoff B — Staff dashboard and admin panel UI

You are building the staff/admin UI for features whose backend is already
built and tested. Two other agents (plans A and C) are working in the same repo
at the same time — **edit only the files listed under "You own"**.

## Environment (read first)

- Repo: `C:\Users\Lorik\source\dentbook` (Windows). Next.js **16** — per
  `AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` before
  writing code; this is not the Next.js from your training data.
- The Bash tool's PATH is sometimes broken. Prefix commands with:
  `export PATH="/usr/bin:/bin:/c/Program Files/nodejs:/c/Windows/System32:/c/Program Files/Git/cmd:$PATH";`
- Postgres (port 5433) — start from **PowerShell** (the npm script breaks in bash):
  `& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D .pgdata -o "-p 5433" -l .pgdata/pg.log -w start`
  MongoDB runs on 27017. Migrations are already applied to dev and test DBs.
- Dev server: run `npx next dev -p 3000` with the Bash tool's `run_in_background`
  (not `&` — it dies with the shell). If one is already running on 3000, use it.
- `SMS_PROVIDER=console`: every SMS prints to the dev server output as
  `[SMS → +383…] …`.
- Seed logins (password `demo1234`): `admin@dentbook.dev` (platform admin),
  `arta@klinika-arta.dev` (owner, Klinika Dentare Arta).
- Baseline: `npx vitest run` → 188 passed. `npx jest` → all passed.
- **Do not commit** unless the user asks. If asked: no Claude co-author
  trailer — commits are under the user's name only.

## What already exists (do not modify `src/lib/**`)

All tested (`tests/appointment-actions.test.ts`, `billing.test.ts`,
`reviews.test.ts`, `cron.test.ts`):

- `src/lib/appointment-actions.ts` — `completeAppointment(ctx, id)` (sends the
  patient a **review invitation SMS** — this is the only trigger for reviews),
  `markNoShow(ctx, id)`, `cancelAppointmentByStaff(ctx, id)` (refunds a paid
  deposit). Status machine: COMPLETED and NO_SHOW only from CONFIRMED.
- New status `AWAITING_PAYMENT` = an unpaid deposit hold; staff can't act on it.
- `src/lib/billing.ts` — `PLAN_PRICE_EUR` (`TRIAL 0, BASIC 29, PRO 59`),
  `listSubscriptionsForAdmin({ userId })` → subscriptions with
  `clinic { name, slug }` and `invoices` (OPEN only), `markInvoicePaid({ userId }, invoiceId)`,
  `setPlan({ userId }, subscriptionId, "BASIC" | "PRO")`,
  `getClinicBillingStatus({ userId, clinicId })` → `{ plan, status, trialEndsAt, currentPeriodEnd } | null`.
  Nothing is gated by plan in v1 (spec §8) — this is invoicing machinery only.
- `src/lib/reviews.ts` — `listReviewsForModeration({ userId })` (newest first,
  includes HIDDEN, with `clinic { name, slug }`), `setReviewStatus({ userId }, id, "PUBLISHED" | "HIDDEN")`.
- `src/lib/cron.ts` — `runScheduledJobs()` → `Record<jobName, { ok: true, result } | { ok: false, error }>`
  (expire deposit holds, expire stale requests, 24h reminders, billing
  rollover, OTP cleanup).
- Existing patterns to copy: `requireStaff()` (`src/lib/staff-context.ts`),
  `requirePlatformAdmin()` (`src/lib/admin-context.ts`), server actions with
  `revalidatePath` in `src/app/[locale]/dashboard/requests/page.tsx`.

## You own

- `src/app/[locale]/dashboard/page.tsx`
- `src/app/[locale]/dashboard/layout.tsx`
- `src/app/[locale]/admin/page.tsx`
- Translation namespaces **`Dashboard`, `Admin`** in `src/messages/en.json`
  and `src/messages/sq.json` — nothing else in those files.

## Tasks

### 1. Dashboard — today's appointments (`dashboard/page.tsx`)

- For a **CONFIRMED appointment that has started** (`startsAt <= now`): show
  **Complete** and **No-show** buttons (server actions → `completeAppointment`
  / `markNoShow`, then `revalidatePath("/dashboard")`). Re-run `requireStaff()`
  inside each action (existing pattern).
- Show **Cancel** only for PENDING/CONFIRMED appointments that haven't started.
- New section **"Past appointments awaiting outcome"**: CONFIRMED appointments
  from the last 30 days before today, same row + buttons. Without this, staff
  can only close visits on the same day, and missed visits never send a review
  invitation.
- Include `payment` in the query and show a badge: *Deposit paid · 10 €*
  (SUCCEEDED) or *Deposit pending · 10 €* (PENDING).
- Status label: use `getTranslations("Manage.status")` instead of the raw enum.
  (`Manage.status.AWAITING_PAYMENT` is added by plan A — don't add it yourself;
  if it's missing when you test, that's plan A's pending work.)

### 2. Dashboard layout — billing banner (`dashboard/layout.tsx`)

`getClinicBillingStatus(ctx)`: if `status === "PAST_DUE"`, show a coral banner
(`billing.pastDue`) above the page content; if `plan === "TRIAL"` and
`trialEndsAt` is set, show a muted `billing.trialEnds` line with the date.

### 3. Admin panel (`admin/page.tsx`) — keep the existing sections

- **Run scheduled jobs now**: server action → `runScheduledJobs()` →
  `redirect("/admin?ran=<total>&ok=<succeeded>")`; render `jobsRan` from those
  params. This is how the jobs are demoed locally (there's no cron on a laptop).
- **Review moderation**: each review shows clinic name, ★ rating, comment,
  date, and a *Hidden* badge; a toggle button calls `setReviewStatus`.
- **Subscriptions**: per clinic show plan, status (PAST_DUE in coral), trial
  end or "paid through" date; a BASIC/PRO select with prices from
  `PLAN_PRICE_EUR` → `setPlan`; each OPEN invoice shows period + amount + a
  **Mark paid** button → `markInvoicePaid`.
- Every admin action calls `requirePlatformAdmin()` again inside itself.

### 4. Translations (your namespaces only)

The files use **CRLF line endings, 2-space indent, trailing newline**. Merge
keys with one atomic read-modify-write so the other agents' edits aren't lost —
never rewrite the whole file from a stale copy. Save the patch as
`{ "en": {...}, "sq": {...} }` and run:

```bash
node -e '
const fs=require("fs"); const patch=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const merge=(a,b)=>{for(const[k,v]of Object.entries(b))a[k]=v&&typeof v==="object"&&!Array.isArray(v)?merge(a[k]??{},v):v;return a;};
for(const l of["en","sq"]){const p=`src/messages/${l}.json`;const cur=JSON.parse(fs.readFileSync(p,"utf8"));
fs.writeFileSync(p,JSON.stringify(merge(cur,patch[l]),null,2).replace(/\n/g,"\r\n")+"\r\n");}' patch.json
```

| Key | en | sq |
|---|---|---|
| `Dashboard.complete` | Mark completed | Shëno si të përfunduar |
| `Dashboard.noShow` | No-show | Nuk u paraqit |
| `Dashboard.awaitingOutcome` | Past appointments awaiting outcome | Termine të kaluara pa rezultat |
| `Dashboard.depositPaid` | Deposit paid | Depozita e paguar |
| `Dashboard.depositPending` | Deposit pending | Depozita në pritje |
| `Dashboard.billing.pastDue` | Your Dentbook subscription has an overdue invoice. Please contact us to settle it. | Abonimi juaj në Dentbook ka një faturë të vonuar. Ju lutemi na kontaktoni për ta shlyer. |
| `Dashboard.billing.trialEnds` | Free trial until {date} | Provë falas deri më {date} |
| `Admin.reviews` | Review moderation | Moderimi i vlerësimeve |
| `Admin.noReviews` | No reviews yet | Ende nuk ka vlerësime |
| `Admin.hidden` | Hidden | E fshehur |
| `Admin.subscriptions` | Subscriptions | Abonimet |
| `Admin.trialEnds` | Trial ends | Prova mbaron |
| `Admin.periodEnd` | Paid through | E paguar deri më |
| `Admin.markPaid` | Mark paid | Shëno si të paguar |
| `Admin.setPlan` | Set plan | Cakto planin |
| `Admin.runJobs` | Run scheduled jobs now | Ekzekuto punët e planifikuara tani |
| `Admin.runJobsHint` | Reminders, deposit holds, request expiry, billing rollover and OTP cleanup. Also runs automatically every day. | Kujtesat, rezervimet me depozitë, skadimi i kërkesave, faturimi dhe pastrimi i kodeve OTP. Ekzekutohen edhe automatikisht çdo ditë. |
| `Admin.jobsRan` | Scheduled jobs ran: {ok} of {total} succeeded. | Punët e planifikuara u ekzekutuan: {ok} nga {total} me sukses. |

`Admin.publish` / `Admin.hide` already exist — reuse them for the review toggle.
Then check key parity:

```bash
node -e 'const f=(o,p="")=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?f(v,p+k+"."):[p+k]);
const e=new Set(f(require("./src/messages/en.json"))),s=new Set(f(require("./src/messages/sq.json")));
console.log("missing in sq:",[...e].filter(k=>!s.has(k)),"missing in en:",[...s].filter(k=>!e.has(k)))'
```

## Verify (all must pass before you report done)

1. `npx tsc --noEmit` clean; `npx eslint` clean; `npx vitest run` still 188+.
2. In the running app (both `/…` and `/en/…`):
   - As `arta@klinika-arta.dev`: insert a CONFIRMED appointment yesterday for
     a seeded patient (SQL as postgres on 5433, or book one and back-date
     `starts_at`/`ends_at`). It appears under *awaiting outcome* → **Complete**
     → the server log shows a `review_invite` SMS linking to `/review/<token>`.
     **No-show** on another sends no SMS.
   - As `admin@dentbook.dev`: **Run scheduled jobs now** → the seeded clinics'
     trials (ended in August) roll to BASIC with OPEN invoices and show
     PAST_DUE; arta's dashboard shows the overdue banner; **Mark paid** on the
     overdue invoices → ACTIVE and the banner disappears.
   - Hide a review in admin → it disappears from its clinic page; Publish → it
     returns.
3. Report exactly what you verified and anything you couldn't.
