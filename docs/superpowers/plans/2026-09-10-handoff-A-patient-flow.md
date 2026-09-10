# Handoff A — Patient flow UI (booking deposit, pay, manage, review)

You are finishing the patient-facing UI for features whose backend is already
built and tested. Two other agents (plans B and C) are working in the same repo
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
- `SMS_PROVIDER=console`: every SMS (OTP codes included) prints to the dev
  server output as `[SMS → +383…] …`.
- Seed logins (password `demo1234`): `admin@dentbook.dev` (platform admin),
  `arta@klinika-arta.dev` (owner, Klinika Dentare Arta).
- Baseline: `npx vitest run` → 188 passed. `npx jest` → all passed.
- **Do not commit** unless the user asks. If asked: no Claude co-author
  trailer — commits are under the user's name only.

## What already exists (do not modify `src/lib/**`)

All tested (`tests/deposits.test.ts`, `tests/reviews.test.ts`):

- `AppointmentStatus` has a new value `AWAITING_PAYMENT`: a booking for a
  service with `depositEur > 0` holds its slot unpaid for 15 minutes.
- `src/lib/booking.ts` — `createBooking(...)` now returns status
  `"PENDING" | "CONFIRMED" | "AWAITING_PAYMENT"`.
- `src/lib/deposits.ts` — `DEPOSIT_HOLD_MINUTES` (15), `startDeposit(appointmentId)`
  → `{ paymentId, checkoutUrl } | null`, `handleDepositWebhook(payload)`,
  `expireUnpaidDeposits()`, `getDepositForAppointment(appointmentId, patientUserId)`
  → `{ amountEur, status } | null`, `getCheckoutByToken(token)`
  → `{ appointment (with clinic, service), payment: { id, status, amountEur, providerRef } } | null`.
  Paying sends the confirmation SMS; an unpaid hold expires after 15 min.
- `src/lib/reviews.ts` — `getReviewContext(token)` → `{ appointment, review | null } | null`,
  `submitReview(token, { rating, comment })`, throws `ReviewError` with codes
  `NOT_FOUND | NOT_COMPLETED | ALREADY_REVIEWED | INVALID_INPUT`.
  Completing an appointment (plan B's dashboard button) SMSes the patient a
  link to `/review/<manageToken>`.
- `src/lib/otp.ts` — `OtpError` has a new code `SEND_FAILED`.
- `src/lib/availability.ts` — `getAvailableSlots` (one day) and
  `getAvailableSlotsRange({ clinicSlug, serviceId, membershipId, fromDateISO, toDateISO })`.

## You own

- `src/app/[locale]/clinics/[slug]/book/page.tsx`
- `src/app/[locale]/manage/[token]/page.tsx`
- `src/app/[locale]/pay/[token]/page.tsx` (new, already drafted)
- `src/app/[locale]/review/[token]/page.tsx` (new, already drafted)
- Translation namespaces **`Book`, `Manage`, `Pay`, `Review`** in
  `src/messages/en.json` and `src/messages/sq.json` — nothing else in those files.

All four pages were drafted by the previous agent but **never rendered or
typechecked**. Treat them as a starting point to verify, not as done.

## Tasks

### 1. Verify the booking page (already merged — do not rebuild)

The booking page has two recent layers, both already merged in
`book/page.tsx` as of 2026-09-10: a 14-day slot browser (step 3:
`getAvailableSlotsRange`, a `filterByDate` date filter, `showAllDates`,
`noSlotsInRange`) and the deposit flow. Leave the slot browser alone; confirm
the deposit parts are present and work:

- Imports `startDeposit, expireUnpaidDeposits, DEPOSIT_HOLD_MINUTES` from `@/lib/deposits`.
- `await expireUnpaidDeposits()` runs before slots are listed, so abandoned
  checkouts free their slots.
- `confirmAction`: when `r.status === "AWAITING_PAYMENT"` it calls
  `startDeposit(r.appointmentId)` and redirects to its `checkoutUrl`
  **without** `notifyAppointment` (the SMS goes out after payment); otherwise
  notify + redirect to `/manage/<token>?booked=1`.
- The confirm step's summary shows `depositNotice` when
  `service.depositEur > 0` and not rescheduling, and the button reads
  `continueToPayment`. Those two keys don't exist yet — you add them in task 3.

### 2. Verify the pay, manage and review pages

- `/pay/<token>`: PENDING and `AWAITING_PAYMENT` → amount + "Pay" + "Cancel"
  (both post a mock webhook through `handleDepositWebhook`); SUCCEEDED →
  redirects to `/manage/<token>?booked=1`; FAILED/REFUNDED → message + "Book again".
  It is a clearly labelled test-mode page; no real money.
- `/manage/<token>`: shows `Deposit €X · <status>` and, for an unpaid hold, a
  "Pay deposit" link to `/pay/<token>`.
- `/review/<token>`: a 1–5 rating (radio group) + optional comment; shows
  thanks once reviewed; "not yet" if the appointment isn't COMPLETED.

### 3. Translations (your namespaces only)

The files use **CRLF line endings, 2-space indent, trailing newline**. Merge
keys with one atomic read-modify-write so the other agents' edits aren't lost —
never rewrite the whole file from a stale copy. Save the patch as a JSON file
`{ "en": {...}, "sq": {...} }` and run:

```bash
node -e '
const fs=require("fs"); const patch=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const merge=(a,b)=>{for(const[k,v]of Object.entries(b))a[k]=v&&typeof v==="object"&&!Array.isArray(v)?merge(a[k]??{},v):v;return a;};
for(const l of["en","sq"]){const p=`src/messages/${l}.json`;const cur=JSON.parse(fs.readFileSync(p,"utf8"));
fs.writeFileSync(p,JSON.stringify(merge(cur,patch[l]),null,2).replace(/\n/g,"\r\n")+"\r\n");}' patch.json
```

Keys to add (English / Albanian):

| Key | en | sq |
|---|---|---|
| `Book.depositNotice` | This treatment needs a {amount} deposit to confirm. You'll pay it on the next screen — the slot is held for {minutes} minutes. | Ky trajtim kërkon një depozitë prej {amount} për t'u konfirmuar. Do ta paguani në hapin tjetër — orari mbahet i rezervuar për {minutes} minuta. |
| `Book.continueToPayment` | Continue to payment | Vazhdo te pagesa |
| `Book.errors.SEND_FAILED` | We couldn't send the SMS — check the number and try again | SMS-ja nuk u dërgua — kontrolloni numrin dhe provoni përsëri |
| `Manage.status.AWAITING_PAYMENT` | Awaiting deposit | Në pritje të depozitës |
| `Manage.deposit` | Deposit {amount} | Depozita {amount} |
| `Manage.depositStatus.PENDING` | not paid yet | ende e papaguar |
| `Manage.depositStatus.SUCCEEDED` | paid | e paguar |
| `Manage.depositStatus.FAILED` | not paid | e papaguar |
| `Manage.depositStatus.REFUNDED` | refunded | e rimbursuar |
| `Manage.payNow` | Pay deposit | Paguaj depozitën |
| `Pay.testMode` | TEST MODE | MODALITET TESTIMI |
| `Pay.title` | Pay your deposit | Paguani depozitën |
| `Pay.subtitle` | Your slot is held for {minutes} minutes while you pay. | Orari juaj mbahet i rezervuar për {minutes} minuta ndërsa paguani. |
| `Pay.deposit` | Deposit | Depozita |
| `Pay.pay` | Pay {amount} | Paguaj {amount} |
| `Pay.cancel` | Cancel and release the slot | Anulo dhe liro orarin |
| `Pay.released` | This payment was cancelled and the slot has been released. | Kjo pagesë u anulua dhe orari u lirua. |
| `Pay.refunded` | Your payment arrived after the hold expired, so it has been refunded. | Pagesa juaj arriti pasi afati i rezervimit kishte skaduar, prandaj u rimbursua. |
| `Pay.bookAgain` | Book again | Rezervo përsëri |
| `Pay.mockNote` | Dentbook uses a mock payment provider in this environment: no card is charged and no money moves. | Në këtë mjedis Dentbook përdor një ofrues pagesash testues: asnjë kartë nuk tarifohet dhe asnjë para nuk lëviz. |
| `Review.title` | How was your visit? | Si shkoi vizita juaj? |
| `Review.ratingLabel` | Your rating | Vlerësimi juaj |
| `Review.commentLabel` | Comment (optional) | Koment (opsional) |
| `Review.commentPlaceholder` | What went well? What could be better? | Çfarë shkoi mirë? Çfarë mund të ishte më mirë? |
| `Review.submit` | Submit review | Dërgo vlerësimin |
| `Review.thanks` | Thank you — your review is published. | Faleminderit — vlerësimi juaj u publikua. |
| `Review.stars` | {count} out of 5 stars | {count} nga 5 yje |
| `Review.notYet` | Reviews open once your visit is completed. | Vlerësimet hapen pasi vizita të përfundojë. |
| `Review.errors.INVALID_INPUT` | Please pick a rating from 1 to 5 (comments up to 1000 characters). | Zgjidhni një vlerësim nga 1 deri në 5 (komenti deri në 1000 karaktere). |
| `Review.errors.NOT_COMPLETED` | Reviews open once your visit is completed. | Vlerësimet hapen pasi vizita të përfundojë. |
| `Review.errors.ALREADY_REVIEWED` | You've already reviewed this visit. | Ju e keni vlerësuar tashmë këtë vizitë. |
| `Review.errors.NOT_FOUND` | This review link isn't valid. | Ky link vlerësimi nuk është i vlefshëm. |
| `Review.errors.UNKNOWN` | Unexpected error | Gabim i papritur |

Afterwards confirm both files still have identical key sets:

```bash
node -e 'const f=(o,p="")=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?f(v,p+k+"."):[p+k]);
const e=new Set(f(require("./src/messages/en.json"))),s=new Set(f(require("./src/messages/sq.json")));
console.log("missing in sq:",[...e].filter(k=>!s.has(k)),"missing in en:",[...s].filter(k=>!e.has(k)))'
```

## Verify (all must pass before you report done)

1. `npx tsc --noEmit` clean; `npx eslint` clean; `npx vitest run` still 188+.
2. In the running app (both `/…` and `/en/…`):
   - Book **"Mbushje dhëmbi" (Tooth filling, €10 deposit)** at `/clinics/klinika-arta`:
     OTP from the server log → confirm → lands on `/pay/<token>` → Pay →
     `/manage/<token>?booked=1` shows *Deposit €10 · paid*, and the server log
     shows the `booking_confirmed` SMS only after paying.
   - Same again but Cancel on the pay page → "slot released"; the slot is
     bookable again.
   - A no-deposit service still books straight to `/manage/<token>?booked=1`.
   - Review: mark an appointment completed (plan B's dashboard button, or
     `UPDATE appointments SET status='COMPLETED' WHERE manage_token='…'` as
     postgres on port 5433) → open `/review/<token>` → submit 4★ → thanks
     screen; the clinic page's rating updates; a second submit is refused.
3. Report exactly what you verified and anything you couldn't.
