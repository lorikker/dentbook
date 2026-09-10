# Handoff C — Testimonials UI, scheduled jobs wiring, seed data, docs

You are finishing the content and operations pieces for features whose backend
is already built and tested. Two other agents (plans A and B) are working in the
same repo at the same time — **edit only the files listed under "You own"**.

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
- Baseline: `npx vitest run` → 188 passed. `npx jest` → all passed.
- **Do not commit** unless the user asks. If asked: no Claude co-author
  trailer — commits are under the user's name only.

## What already exists (do not modify `src/lib/**` or `src/app/api/**`)

All tested (`tests/testimonials.test.ts`, `tests/cron.test.ts`,
`tests-jest/cron-route.jest.ts`):

- `src/lib/testimonials.ts` — `submitTestimonial({ authorName, quote, role? })`
  → `{ id }` (name 2–80 chars, quote 10–500, role ≤ 80; stored **unpublished**
  for admin moderation), throws `TestimonialError("INVALID_INPUT")`;
  `listPublishedTestimonials(limit = 6)` → `[{ id, authorName, quote, role | null }]`.
  Admin publish/hide already exists in `/admin`.
- `src/lib/cron.ts` — `runScheduledJobs()` → summary per job.
- `src/app/api/cron/tick/route.ts` — `GET`, requires
  `Authorization: Bearer $CRON_SECRET`; 500 when `CRON_SECRET` is unset.
- `src/lib/models/testimonial.ts` — the Mongoose `Testimonial` model.

## You own

- `src/app/[locale]/about/page.tsx`
- `src/app/[locale]/page.tsx` (home) — only to add the testimonials section
- `src/components/HomeTestimonials.tsx` (new)
- `vercel.json` (new), `scripts/cron-tick.ts` (new)
- `package.json` — the `scripts` block only
- `prisma/seed.ts`
- `README.md`, `.env.example`, and `.env` (**append only** — never rewrite
  `.env`; it holds the user's local secrets)
- Translation namespaces **`About`** and **`Home.testimonials`** in
  `src/messages/en.json` and `src/messages/sq.json` — nothing else in those files.

## Tasks

### 1. Testimonials on Home and About

- `src/components/HomeTestimonials.tsx` — async server component: fetch
  `listPublishedTestimonials(3)` with `.catch(() => [])` (log the error), so the
  **home page never fails if Mongo is down**; render nothing when empty;
  otherwise a bordered band (`border-t border-ink-line`, `Container py-20`)
  with `SectionKicker` + heading + 3 quote cards, matching the home page's
  existing section style.
- Home page: import it and render `<HomeTestimonials />` just before the
  "For clinics CTA" block. No other home-page changes.
- About page: a **"Share your experience"** form (`id="share"`; name, optional
  role, quote) posting to a server action → `submitTestimonial` →
  `redirect("/about?thanks=1#share")`, or `?error=invalid` on
  `TestimonialError` / `?error=failed` otherwise. Show the thanks/error message.
  Match the input styling of `src/app/[locale]/contact/page.tsx`.

### 2. Scheduled jobs wiring

- `vercel.json`:
  `{ "crons": [{ "path": "/api/cron/tick", "schedule": "0 17 * * *" }] }`.
  Why 17:00 UTC daily: Vercel Hobby allows one run a day. With the 24-hour
  reminder window, a 17:00 UTC run reminds every appointment in clinic hours
  the evening before. Deposit holds are also expired on every booking, so they
  don't depend on the cron.
- `scripts/cron-tick.ts`: `import "dotenv/config"`, call `runScheduledJobs()`,
  print the JSON summary, exit 1 if any job failed. Add
  `"cron:tick": "tsx scripts/cron-tick.ts"` to `package.json` scripts.
- Append to `.env` (append only, e.g. `cat >> .env`) a `CRON_SECRET` with a
  random value (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`),
  under a `# --- Scheduled jobs ---` comment. Append `CRON_SECRET="change-me"`
  with the same comment to `.env.example`.

### 3. Seed demo data (`prisma/seed.ts`, keep it idempotent)

After the existing clinic loop:
- **Reviews** so ratings show out of the box: for `klinika-arta` (2 reviews:
  5★ and 4★) and `dental-prizren` (1 review, 5★) — skip a clinic that already
  has reviews. For each: upsert a patient by phone (e.g. `+38344555001`…),
  create a **COMPLETED** appointment ~14 days ago with the clinic's first
  dentist and service, then the review. Use short Albanian comments.
- **Testimonials** in Mongo, only if `MONGODB_URI` is set and the collection
  is empty: 3 published documents via the `Testimonial` model (e.g. two
  patients, one dentist). Connect with mongoose and disconnect at the end.

### 4. Docs

- `README.md`: add features — verified reviews (invite on completion, admin
  moderation), deposits (mock payment provider, 15-min slot hold), 24h
  reminders, subscription invoicing (admin mark-paid, overdue flag, nothing
  gated), testimonials, scheduled jobs. Add `CRON_SECRET` to the env table.
  Add a "Scheduled jobs" section: what runs, `vercel.json` schedule and why,
  `npm run cron:tick` locally, and the admin panel's "Run scheduled jobs now"
  button. In Deployment, say to set `CRON_SECRET` in Vercel.

### 5. Translations (your namespaces only)

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
| `About.shareTitle` | Share your experience | Ndani përvojën tuaj |
| `About.shareIntro` | Booked through Dentbook? Tell others how it went. Testimonials appear after a quick review. | Keni rezervuar përmes Dentbook? Tregojuni të tjerëve si shkoi. Dëshmitë shfaqen pas një kontrolli të shkurtër. |
| `About.name` | Your name | Emri juaj |
| `About.role` | Who you are (optional, e.g. patient in Prishtina) | Kush jeni (opsionale, p.sh. paciente në Prishtinë) |
| `About.quote` | Your experience | Përvoja juaj |
| `About.submit` | Send | Dërgo |
| `About.thanks` | Thank you! Your testimonial will appear once it's approved. | Faleminderit! Dëshmia juaj do të shfaqet pasi të aprovohet. |
| `About.invalid` | Please add your name and 10–500 characters about your experience. | Shkruani emrin dhe 10–500 karaktere për përvojën tuaj. |
| `About.failed` | Something went wrong — please try again later. | Diçka shkoi keq — provoni përsëri më vonë. |
| `Home.testimonials.kicker` | Patients say | Çfarë thonë pacientët |
| `Home.testimonials.title` | In their own words | Me fjalët e tyre |

Then check key parity:

```bash
node -e 'const f=(o,p="")=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?f(v,p+k+"."):[p+k]);
const e=new Set(f(require("./src/messages/en.json"))),s=new Set(f(require("./src/messages/sq.json")));
console.log("missing in sq:",[...e].filter(k=>!s.has(k)),"missing in en:",[...s].filter(k=>!e.has(k)))'
```

## Verify (all must pass before you report done)

1. `npx tsc --noEmit` clean; `npx eslint` clean; `npx vitest run` still 188+;
   `npx jest` passes (includes the cron route test).
2. `npm run db:seed` twice — the second run adds nothing (idempotent); the
   clinic pages and home show ratings.
3. `npm run cron:tick` prints a summary with every job `ok: true`.
4. With the dev server running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/cron/tick`
   → 401; with `-H "Authorization: Bearer <CRON_SECRET>"` → 200.
   (The dev server must be restarted after adding `CRON_SECRET` to `.env`.)
5. Home shows the seeded testimonials (both `/` and `/en`). Submit the About
   form → thanks message → the testimonial appears unpublished in `/admin`
   (log in as `admin@dentbook.dev` / `demo1234`) → Publish → it shows on home.
   Stop MongoDB (or unset `MONGODB_URI`) briefly: home still renders.
6. Report exactly what you verified and anything you couldn't.
