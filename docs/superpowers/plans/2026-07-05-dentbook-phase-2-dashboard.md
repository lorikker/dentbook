# Dentbook Phase 2 — Clinic Dashboard & Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clinic owners can self-register, and staff manage their clinic from a dashboard: services, staff members, weekly schedules with exceptions, clinic settings — plus a fully unit-tested slot-computation library that Plan 3's booking flow will consume.

**Architecture:** All mutations are Next.js server actions that call small, DB-backed lib functions running under `withDbContext` (RLS enforced). The slot computer is a pure function with no DB dependency. UI is server-rendered, minimal Tailwind.

**Tech Stack:** as Phase 1 (Next 16, Prisma 7 + adapter-pg, Auth.js v5, next-intl, Vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-dentbook-design.md` (§8 onboarding, §6 model)
**Branch:** `feature/phase-2-dashboard`

---

## File structure created by this plan

```
src/
├── lib/
│   ├── staff-context.ts        # resolve session → {userId, clinicId, role}
│   ├── register-clinic.ts      # owner signup: user+clinic+membership+subscription
│   ├── services.ts             # service CRUD under staff context
│   ├── staff-members.ts        # add/list staff, dentist profiles
│   ├── schedules.ts            # weekly hours + exceptions (validated)
│   ├── clinic-settings.ts      # booking mode, cancellation window, profile
│   └── slots.ts                # PURE slot computation (no DB)
├── app/[locale]/
│   ├── register/page.tsx       # clinic self-signup
│   └── dashboard/
│       ├── layout.tsx          # auth guard + nav
│       ├── page.tsx            # today's appointments
│       ├── services/page.tsx
│       ├── staff/page.tsx
│       ├── schedules/page.tsx
│       └── settings/page.tsx
tests/
├── register-clinic.test.ts
├── services.test.ts
├── staff-members.test.ts
├── schedules.test.ts
└── slots.test.ts               # the heavy one — pure unit tests
```

Strings: every user-facing label added to `src/messages/sq.json` and `en.json` under `Dashboard`, `Register` namespaces.

---

### Task 1: Staff context resolution

**Files:** Create `src/lib/staff-context.ts`, `tests/staff-context.test.ts`

- [ ] **Step 1: failing test** — `tests/staff-context.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { resolveStaffMembership } from "@/lib/staff-context";

let ownerId: string, patientId: string, clinicId: string;

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "ctx-klinika", name: "Ctx", city: "Prishtinë",
            address: "x", phone: "x" },
  });
  clinicId = clinic.id;
  const owner = await direct.user.create({
    data: { name: "Owner", email: "ctx-owner@x.com", passwordHash: "x" },
  });
  ownerId = owner.id;
  await direct.membership.create({
    data: { userId: ownerId, clinicId, role: "OWNER" },
  });
  const patient = await direct.user.create({
    data: { name: "P", phone: "+38344555000" },
  });
  patientId = patient.id;
});

afterAll(async () => { await direct.$disconnect(); });

describe("resolveStaffMembership", () => {
  it("returns clinic + role for staff", async () => {
    const ctx = await resolveStaffMembership(ownerId);
    expect(ctx).toEqual({ clinicId, role: "OWNER", membershipId: expect.any(String) });
  });
  it("returns null for users with no membership", async () => {
    expect(await resolveStaffMembership(patientId)).toBeNull();
  });
});
```

- [ ] **Step 2: run, expect FAIL** (`npm run test -- tests/staff-context.test.ts`)
- [ ] **Step 3: implement** — `src/lib/staff-context.ts`

```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { withDbContext } from "./tenant-db";
import type { MembershipRole } from "@/generated/prisma/client";

export interface StaffContext {
  userId: string;
  clinicId: string;
  membershipId: string;
  role: MembershipRole;
}

/** First membership wins; multi-clinic switching is out of scope for v1. */
export async function resolveStaffMembership(userId: string) {
  return withDbContext({ role: "auth", userId }, async (tx) => {
    const m = await tx.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return m ? { clinicId: m.clinicId, membershipId: m.id, role: m.role } : null;
  });
}

/** For server components/actions: redirects to login when not staff. */
export async function requireStaff(): Promise<StaffContext> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const m = await resolveStaffMembership(session.user.id);
  if (!m) redirect("/login");
  return { userId: session.user.id, ...m };
}
```

- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: commit** `feat: staff context resolution for dashboard`

---

### Task 2: Clinic self-registration

**Files:** Create `src/lib/register-clinic.ts`, `tests/register-clinic.test.ts`, `src/app/[locale]/register/page.tsx`

- [ ] **Step 1: failing tests** — `tests/register-clinic.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { registerClinic, RegisterError } from "@/lib/register-clinic";

const INPUT = {
  ownerName: "Arta B", email: "arta@new.dev", password: "sekret123",
  clinicName: "Klinika e Re", city: "Gjakovë", address: "Rr. 1", phone: "+38344777000",
};

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await direct.$disconnect(); });

describe("registerClinic", () => {
  it("creates user, unpublished clinic, OWNER membership, TRIAL subscription", async () => {
    const { clinicId } = await registerClinic(INPUT);
    const clinic = await direct.clinic.findUniqueOrThrow({
      where: { id: clinicId }, include: { memberships: true, subscription: true },
    });
    expect(clinic.published).toBe(false);
    expect(clinic.slug).toBe("klinika-e-re");
    expect(clinic.memberships[0].role).toBe("OWNER");
    expect(clinic.subscription?.plan).toBe("TRIAL");
    const user = await direct.user.findUnique({ where: { email: INPUT.email } });
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toBe(INPUT.password);
  });

  it("suffixes the slug when taken", async () => {
    await registerClinic(INPUT);
    const second = await registerClinic({
      ...INPUT, email: "tjeter@new.dev", phone: "+38344777001" });
    const c2 = await direct.clinic.findUniqueOrThrow({ where: { id: second.clinicId } });
    expect(c2.slug).toBe("klinika-e-re-2");
  });

  it("rejects duplicate owner email", async () => {
    await registerClinic(INPUT);
    await expect(registerClinic(INPUT)).rejects.toThrow(RegisterError);
  });

  it("rejects invalid input (short password)", async () => {
    await expect(registerClinic({ ...INPUT, password: "x" }))
      .rejects.toThrow(RegisterError);
  });
});
```

- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** — `src/lib/register-clinic.ts`

```ts
import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { hashPassword } from "./staff-auth";

export class RegisterError extends Error {
  constructor(public code: "INVALID_INPUT" | "EMAIL_TAKEN") { super(code); }
}

const schema = z.object({
  ownerName: z.string().min(2),
  email: z.email(),
  password: z.string().min(8),
  clinicName: z.string().min(2),
  city: z.string().min(2),
  address: z.string().min(2),
  phone: z.string().min(8),
});
export type RegisterInput = z.infer<typeof schema>;

export function slugify(name: string): string {
  return name.toLowerCase()
    .replaceAll("ë", "e").replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function registerClinic(input: RegisterInput) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new RegisterError("INVALID_INPUT");
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);

  return withDbContext({ role: "auth" }, async (tx) => {
    if (await tx.user.findUnique({ where: { email: d.email } })) {
      throw new RegisterError("EMAIL_TAKEN");
    }
    const base = slugify(d.clinicName);
    let slug = base;
    for (let i = 2; await tx.clinic.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`;
    }
    const user = await tx.user.create({
      data: { name: d.ownerName, email: d.email, passwordHash },
    });
    const clinic = await tx.clinic.create({
      data: { slug, name: d.clinicName, city: d.city,
              address: d.address, phone: d.phone },
    });
    await tx.membership.create({
      data: { userId: user.id, clinicId: clinic.id, role: "OWNER" },
    });
    await tx.subscription.create({
      data: { clinicId: clinic.id, plan: "TRIAL", status: "ACTIVE",
              trialEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    });
    return { clinicId: clinic.id, userId: user.id };
  });
}
```

RLS note: `subscriptions_all` policy requires `clinic_id = app_clinic_id()` — the
`auth` role has no clinic set, so **add a migration** widening the policy:

```powershell
npx prisma migrate dev --create-only --name subscriptions_auth_insert
```

```sql
DROP POLICY subscriptions_all ON subscriptions;
CREATE POLICY subscriptions_all ON subscriptions FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'))
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'));
```

Then `npx prisma migrate dev`.

(memberships_write has the same gap for `auth` — widen it identically in the same migration:)

```sql
DROP POLICY memberships_write ON memberships;
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'))
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'));
```

- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: registration page** — `src/app/[locale]/register/page.tsx`

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { registerClinic, RegisterError } from "@/lib/register-clinic";

export default async function RegisterPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("Register");
  const { error } = await searchParams;

  async function action(formData: FormData) {
    "use server";
    try {
      await registerClinic({
        ownerName: String(formData.get("ownerName") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        clinicName: String(formData.get("clinicName") ?? ""),
        city: String(formData.get("city") ?? ""),
        address: String(formData.get("address") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      });
    } catch (e) {
      redirect(`/register?error=${e instanceof RegisterError ? e.code : "UNKNOWN"}`);
    }
    redirect("/login?registered=1");
  }

  const fields = [
    ["ownerName", "text"], ["email", "email"], ["password", "password"],
    ["clinicName", "text"], ["city", "text"], ["address", "text"], ["phone", "tel"],
  ] as const;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {error && <p className="text-sm text-red-600">{t(`errors.${error}` as never)}</p>}
      <form action={action} className="flex flex-col gap-3">
        {fields.map(([name, type]) => (
          <input key={name} name={name} type={type} required
                 placeholder={t(`fields.${name}` as never)}
                 className="rounded border p-2" />
        ))}
        <button className="rounded bg-sky-600 p-2 text-white">{t("submit")}</button>
      </form>
    </main>
  );
}
```

Add `Register` strings to both message files (sq shown; translate for en):

```json
"Register": {
  "title": "Regjistro klinikën tënde",
  "submit": "Regjistrohu",
  "fields": { "ownerName": "Emri juaj", "email": "Email", "password": "Fjalëkalimi",
    "clinicName": "Emri i klinikës", "city": "Qyteti", "address": "Adresa", "phone": "Telefoni" },
  "errors": { "INVALID_INPUT": "Të dhëna të pavlefshme", "EMAIL_TAKEN": "Ky email është i zënë", "UNKNOWN": "Gabim i papritur" }
}
```

- [ ] **Step 6: build passes, commit** `feat: clinic self-registration with owner account`

---

### Task 3: Dashboard shell

**Files:** Create `src/app/[locale]/dashboard/layout.tsx`, `src/app/[locale]/dashboard/page.tsx`

- [ ] **Step 1: layout with guard + nav**

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";

export default async function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard");
  const clinic = await withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.clinic.findUniqueOrThrow({ where: { id: ctx.clinicId } }),
  );
  const nav = [
    ["", t("nav.appointments")], ["services", t("nav.services")],
    ["staff", t("nav.staff")], ["schedules", t("nav.schedules")],
    ["settings", t("nav.settings")],
  ] as const;
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-gray-50 p-4">
        <p className="mb-6 font-bold">{clinic.name}</p>
        <nav className="flex flex-col gap-2">
          {nav.map(([href, label]) => (
            <Link key={href} href={`/dashboard/${href}`}
                  className="rounded px-2 py-1 hover:bg-gray-200">{label}</Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: appointments page (today)** — `src/app/[locale]/dashboard/page.tsx`

```tsx
import { getTranslations, getFormatter } from "next-intl/server";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";

export default async function AppointmentsToday() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard");
  const format = await getFormatter();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const appts = await withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.appointment.findMany({
      where: { startsAt: { gte: start, lt: end } },
      include: { patient: true, service: true, membership: { include: { user: true } } },
      orderBy: { startsAt: "asc" },
    }),
  );
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("todayTitle")}</h1>
      {appts.length === 0 && <p className="text-gray-500">{t("noAppointments")}</p>}
      <ul className="flex flex-col gap-2">
        {appts.map((a) => (
          <li key={a.id} className="rounded border p-3">
            <span className="font-mono">{format.dateTime(a.startsAt, { hour: "2-digit", minute: "2-digit" })}</span>
            {" — "}{a.patient.name} · {a.service.nameSq} · {a.membership.user.name}
            <span className="ml-2 rounded bg-gray-100 px-2 text-sm">{a.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Add `Dashboard.nav.*`, `todayTitle`, `noAppointments` strings (sq+en).

- [ ] **Step 3: build + manual smoke (login as `arta@klinika-arta.dev`/`demo1234` → dashboard renders), commit** `feat: dashboard shell with today's appointments`

---

### Task 4: Services management

**Files:** Create `src/lib/services.ts`, `tests/services.test.ts`, `src/app/[locale]/dashboard/services/page.tsx`

- [ ] **Step 1: failing tests** — `tests/services.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { createService, updateService, ServiceError } from "@/lib/services";

let staffCtx: { userId: string; clinicId: string };

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "svc-klinika", name: "Svc", city: "P", address: "x", phone: "x" },
  });
  const owner = await direct.user.create({
    data: { name: "O", email: "svc@x.com", passwordHash: "x" },
  });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" },
  });
  staffCtx = { userId: owner.id, clinicId: clinic.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("services", () => {
  it("creates a service in the staff clinic", async () => {
    const s = await createService(staffCtx, {
      nameSq: "Pastrim", nameEn: "Cleaning", durationMin: 30, priceEur: 25 });
    expect(s.clinicId).toBe(staffCtx.clinicId);
  });
  it("rejects invalid duration", async () => {
    await expect(createService(staffCtx, {
      nameSq: "X", nameEn: "X", durationMin: 3, priceEur: 10 }))
      .rejects.toThrow(ServiceError);
  });
  it("updates and deactivates", async () => {
    const s = await createService(staffCtx, {
      nameSq: "Mbushje", nameEn: "Filling", durationMin: 60, priceEur: 40 });
    const upd = await updateService(staffCtx, s.id, { priceEur: 45, active: false });
    expect(Number(upd.priceEur)).toBe(45);
    expect(upd.active).toBe(false);
  });
  it("cannot touch another clinic's service", async () => {
    const other = await direct.clinic.create({
      data: { slug: "svc-other", name: "O", city: "P", address: "x", phone: "x" } });
    const foreign = await direct.service.create({
      data: { clinicId: other.id, nameSq: "F", nameEn: "F", durationMin: 30, priceEur: 10 } });
    await expect(updateService(staffCtx, foreign.id, { priceEur: 1 }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: run, FAIL** → **Step 3: implement** — `src/lib/services.ts`

```ts
import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class ServiceError extends Error {
  constructor(public code: "INVALID_INPUT" | "NOT_FOUND") { super(code); }
}

const base = z.object({
  nameSq: z.string().min(2),
  nameEn: z.string().min(2),
  durationMin: z.number().int().min(5).max(480),
  priceEur: z.number().min(0).max(10000),
  depositEur: z.number().min(0).max(10000).nullish(),
  active: z.boolean().optional(),
});

type StaffCtx = { userId: string; clinicId: string };
const ctxOf = (c: StaffCtx) =>
  ({ role: "staff" as const, userId: c.userId, clinicId: c.clinicId });

export async function listServices(ctx: StaffCtx) {
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.service.findMany({ where: { clinicId: ctx.clinicId }, orderBy: { nameSq: "asc" } }));
}

export async function createService(ctx: StaffCtx, input: unknown) {
  const parsed = base.safeParse(input);
  if (!parsed.success) throw new ServiceError("INVALID_INPUT");
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.service.create({ data: { ...parsed.data, clinicId: ctx.clinicId } }));
}

export async function updateService(ctx: StaffCtx, id: string, input: unknown) {
  const parsed = base.partial().safeParse(input);
  if (!parsed.success) throw new ServiceError("INVALID_INPUT");
  const res = await withDbContext(ctxOf(ctx), (tx) =>
    tx.service.updateMany({ where: { id }, data: parsed.data }));
  if (res.count === 0) throw new ServiceError("NOT_FOUND"); // RLS filtered it out
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.service.findUniqueOrThrow({ where: { id } }));
}
```

- [ ] **Step 4: run, PASS** → **Step 5: page** — `src/app/[locale]/dashboard/services/page.tsx`

```tsx
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { listServices, createService, updateService } from "@/lib/services";

export default async function ServicesPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.services");
  const services = await listServices(ctx);

  async function createAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await createService(c, {
      nameSq: String(formData.get("nameSq") ?? ""),
      nameEn: String(formData.get("nameEn") ?? ""),
      durationMin: Number(formData.get("durationMin")),
      priceEur: Number(formData.get("priceEur")),
      depositEur: formData.get("depositEur") ? Number(formData.get("depositEur")) : null,
    });
    revalidatePath("/dashboard/services");
  }

  async function toggleAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await updateService(c, String(formData.get("id")),
      { active: formData.get("active") === "true" });
    revalidatePath("/dashboard/services");
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <table className="mb-8 w-full text-left">
        <thead><tr className="border-b">
          <th className="py-2">{t("name")}</th><th>{t("duration")}</th>
          <th>{t("price")}</th><th>{t("deposit")}</th><th></th>
        </tr></thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id} className={`border-b ${s.active ? "" : "opacity-40"}`}>
              <td className="py-2">{s.nameSq}</td>
              <td>{s.durationMin} min</td>
              <td>{String(s.priceEur)} €</td>
              <td>{s.depositEur ? `${s.depositEur} €` : "—"}</td>
              <td>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="active" value={String(!s.active)} />
                  <button className="text-sm text-sky-700 underline">
                    {s.active ? t("deactivate") : t("activate")}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 font-semibold">{t("addTitle")}</h2>
      <form action={createAction} className="flex max-w-md flex-col gap-2">
        <input name="nameSq" required placeholder={t("nameSq")} className="rounded border p-2" />
        <input name="nameEn" required placeholder={t("nameEn")} className="rounded border p-2" />
        <input name="durationMin" type="number" required placeholder={t("duration")} className="rounded border p-2" />
        <input name="priceEur" type="number" step="0.01" required placeholder={t("price")} className="rounded border p-2" />
        <input name="depositEur" type="number" step="0.01" placeholder={t("deposit")} className="rounded border p-2" />
        <button className="rounded bg-sky-600 p-2 text-white">{t("add")}</button>
      </form>
    </div>
  );
}
```

Add `Dashboard.services.*` strings (sq+en).

- [ ] **Step 6: build, commit** `feat: services management`

---

### Task 5: Staff management

**Files:** Create `src/lib/staff-members.ts`, `tests/staff-members.test.ts`, `src/app/[locale]/dashboard/staff/page.tsx`

- [ ] **Step 1: failing tests** — `tests/staff-members.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { addStaffMember, StaffError } from "@/lib/staff-members";

let ownerCtx: { userId: string; clinicId: string; role: "OWNER" };
let receptionCtx: { userId: string; clinicId: string; role: "RECEPTIONIST" };

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "st-klinika", name: "St", city: "P", address: "x", phone: "x" } });
  const owner = await direct.user.create({
    data: { name: "O", email: "st-owner@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  const rec = await direct.user.create({
    data: { name: "R", email: "st-rec@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: rec.id, clinicId: clinic.id, role: "RECEPTIONIST" } });
  ownerCtx = { userId: owner.id, clinicId: clinic.id, role: "OWNER" };
  receptionCtx = { userId: rec.id, clinicId: clinic.id, role: "RECEPTIONIST" };
});
afterAll(async () => { await direct.$disconnect(); });

describe("addStaffMember", () => {
  it("owner adds a dentist with profile and temp password", async () => {
    const m = await addStaffMember(ownerCtx, {
      name: "Dr. Test", email: "dr-test@x.com", password: "fillestar1",
      role: "DENTIST", title: "Dr. med. dent." });
    expect(m.role).toBe("DENTIST");
    expect(m.title).toBe("Dr. med. dent.");
    const u = await direct.user.findUnique({ where: { email: "dr-test@x.com" } });
    expect(u?.passwordHash).toBeTruthy();
  });
  it("attaches an existing user by email instead of duplicating", async () => {
    const existing = await direct.user.create({
      data: { name: "E", email: "ex@x.com", passwordHash: "y" } });
    const m = await addStaffMember(ownerCtx, {
      name: "ignored", email: "ex@x.com", password: "ignored123",
      role: "RECEPTIONIST" });
    expect(m.userId).toBe(existing.id);
  });
  it("non-owner cannot add staff", async () => {
    await expect(addStaffMember(receptionCtx, {
      name: "X", email: "no@x.com", password: "12345678", role: "DENTIST" }))
      .rejects.toThrow(StaffError);
  });
});
```

- [ ] **Step 2: FAIL** → **Step 3: implement** — `src/lib/staff-members.ts`

```ts
import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { hashPassword } from "./staff-auth";
import type { MembershipRole } from "@/generated/prisma/client";

export class StaffError extends Error {
  constructor(public code: "INVALID_INPUT" | "FORBIDDEN") { super(code); }
}

const schema = z.object({
  name: z.string().min(2),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(["DENTIST", "RECEPTIONIST", "OWNER"]),
  title: z.string().optional(),
  bio: z.string().optional(),
});

type StaffCtx = { userId: string; clinicId: string; role: MembershipRole };

export async function listStaff(ctx: StaffCtx) {
  return withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.membership.findMany({
      where: { clinicId: ctx.clinicId },
      include: { user: true }, orderBy: { createdAt: "asc" } }));
}

export async function addStaffMember(ctx: StaffCtx, input: unknown) {
  if (ctx.role !== "OWNER") throw new StaffError("FORBIDDEN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new StaffError("INVALID_INPUT");
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);
  // user lookup/creation needs the auth context; membership needs staff context
  return withDbContext(
    { role: "auth", userId: ctx.userId, clinicId: ctx.clinicId },
    async (tx) => {
      const user =
        (await tx.user.findUnique({ where: { email: d.email } })) ??
        (await tx.user.create({
          data: { name: d.name, email: d.email, passwordHash } }));
      return tx.membership.create({
        data: { userId: user.id, clinicId: ctx.clinicId, role: d.role,
                title: d.title, bio: d.bio } });
    });
}
```

- [ ] **Step 4: PASS** → **Step 5: page** — `src/app/[locale]/dashboard/staff/page.tsx`

```tsx
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { listStaff, addStaffMember } from "@/lib/staff-members";

export default async function StaffPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.staff");
  const staff = await listStaff(ctx);

  async function addAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await addStaffMember(c, {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? ""),
      title: String(formData.get("title") ?? "") || undefined,
    });
    revalidatePath("/dashboard/staff");
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <ul className="mb-8 flex flex-col gap-2">
        {staff.map((m) => (
          <li key={m.id} className="rounded border p-3">
            {m.user.name} — {m.role}{m.title ? ` · ${m.title}` : ""}
            <span className="ml-2 text-sm text-gray-500">{m.user.email}</span>
          </li>
        ))}
      </ul>
      {ctx.role === "OWNER" && (
        <>
          <h2 className="mb-2 font-semibold">{t("addTitle")}</h2>
          <form action={addAction} className="flex max-w-md flex-col gap-2">
            <input name="name" required placeholder={t("name")} className="rounded border p-2" />
            <input name="email" type="email" required placeholder={t("email")} className="rounded border p-2" />
            <input name="password" required placeholder={t("tempPassword")} className="rounded border p-2" />
            <select name="role" className="rounded border p-2">
              <option value="DENTIST">{t("roles.DENTIST")}</option>
              <option value="RECEPTIONIST">{t("roles.RECEPTIONIST")}</option>
              <option value="OWNER">{t("roles.OWNER")}</option>
            </select>
            <input name="title" placeholder={t("titleField")} className="rounded border p-2" />
            <button className="rounded bg-sky-600 p-2 text-white">{t("add")}</button>
          </form>
        </>
      )}
    </div>
  );
}
```

Add `Dashboard.staff.*` strings (sq+en).

- [ ] **Step 6: build, commit** `feat: staff management`

---

### Task 6: Schedules & exceptions

**Files:** Create `src/lib/schedules.ts`, `tests/schedules.test.ts`, `src/app/[locale]/dashboard/schedules/page.tsx`

- [ ] **Step 1: failing tests** — `tests/schedules.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { setWeeklySchedule, addException, ScheduleError } from "@/lib/schedules";

let ctx: { userId: string; clinicId: string };
let dentistMembershipId: string;

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "sch-klinika", name: "S", city: "P", address: "x", phone: "x" } });
  const owner = await direct.user.create({
    data: { name: "O", email: "sch@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  const dr = await direct.user.create({
    data: { name: "D", email: "sch-dr@x.com", passwordHash: "x" } });
  const m = await direct.membership.create({
    data: { userId: dr.id, clinicId: clinic.id, role: "DENTIST" } });
  ctx = { userId: owner.id, clinicId: clinic.id };
  dentistMembershipId = m.id;
});
afterAll(async () => { await direct.$disconnect(); });

describe("setWeeklySchedule", () => {
  it("replaces the weekly schedule atomically", async () => {
    await setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 1, startMin: 540, endMin: 1020 },
      { weekday: 2, startMin: 540, endMin: 1020 },
    ]);
    await setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 3, startMin: 600, endMin: 960 },
    ]);
    const rows = await direct.schedule.findMany({
      where: { membershipId: dentistMembershipId } });
    expect(rows.length).toBe(1);
    expect(rows[0].weekday).toBe(3);
  });
  it("rejects start >= end", async () => {
    await expect(setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 1, startMin: 600, endMin: 600 }]))
      .rejects.toThrow(ScheduleError);
  });
  it("rejects overlapping entries on the same weekday", async () => {
    await expect(setWeeklySchedule(ctx, dentistMembershipId, [
      { weekday: 1, startMin: 540, endMin: 720 },
      { weekday: 1, startMin: 700, endMin: 900 }]))
      .rejects.toThrow(ScheduleError);
  });
});

describe("addException", () => {
  it("adds a closed day", async () => {
    const e = await addException(ctx, {
      membershipId: dentistMembershipId, date: "2026-11-28", closed: true });
    expect(e.closed).toBe(true);
  });
  it("rejects altered hours without times", async () => {
    await expect(addException(ctx, {
      membershipId: dentistMembershipId, date: "2026-11-29", closed: false }))
      .rejects.toThrow(ScheduleError);
  });
});
```

- [ ] **Step 2: FAIL** → **Step 3: implement** — `src/lib/schedules.ts`

```ts
import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class ScheduleError extends Error {
  constructor(public code: "INVALID_INPUT" | "OVERLAP" | "NOT_FOUND") { super(code); }
}

const entrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
});
export type WeeklyEntry = z.infer<typeof entrySchema>;

type StaffCtx = { userId: string; clinicId: string };
const ctxOf = (c: StaffCtx) =>
  ({ role: "staff" as const, userId: c.userId, clinicId: c.clinicId });

export async function setWeeklySchedule(
  ctx: StaffCtx, membershipId: string, entries: WeeklyEntry[],
) {
  const parsed = z.array(entrySchema).safeParse(entries);
  if (!parsed.success) throw new ScheduleError("INVALID_INPUT");
  for (const e of parsed.data) {
    if (e.startMin >= e.endMin) throw new ScheduleError("INVALID_INPUT");
  }
  // overlap check per weekday
  for (let d = 0; d <= 6; d++) {
    const day = parsed.data.filter((e) => e.weekday === d)
      .sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < day.length; i++) {
      if (day[i].startMin < day[i - 1].endMin) throw new ScheduleError("OVERLAP");
    }
  }
  return withDbContext(ctxOf(ctx), async (tx) => {
    // RLS guarantees membership belongs to this clinic (schedules_write policy)
    await tx.schedule.deleteMany({ where: { membershipId } });
    if (parsed.data.length > 0) {
      await tx.schedule.createMany({
        data: parsed.data.map((e) => ({ ...e, membershipId })) });
    }
  });
}

const exceptionSchema = z.object({
  membershipId: z.string().uuid().nullish(), // null = clinic-wide
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closed: z.boolean(),
  startMin: z.number().int().min(0).max(1439).nullish(),
  endMin: z.number().int().min(1).max(1440).nullish(),
}).refine((e) => e.closed || (e.startMin != null && e.endMin != null && e.startMin < e.endMin));

export async function addException(ctx: StaffCtx, input: unknown) {
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) throw new ScheduleError("INVALID_INPUT");
  const d = parsed.data;
  return withDbContext(ctxOf(ctx), (tx) =>
    tx.scheduleException.create({
      data: { clinicId: ctx.clinicId, membershipId: d.membershipId ?? null,
              date: new Date(`${d.date}T00:00:00Z`), closed: d.closed,
              startMin: d.startMin ?? null, endMin: d.endMin ?? null } }));
}

export async function listSchedulesForClinic(ctx: StaffCtx) {
  return withDbContext(ctxOf(ctx), async (tx) => {
    const dentists = await tx.membership.findMany({
      where: { clinicId: ctx.clinicId, role: "DENTIST" },
      include: { user: true, schedules: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] } },
    });
    return dentists;
  });
}
```

- [ ] **Step 4: PASS** → **Step 5: schedules page** — table of dentists with weekly entries + form posting rows `weekday,start,end` per line; complete code in the same style as Task 4/5 pages (list + form + server actions calling `setWeeklySchedule`/`addException`; times entered as `HH:mm` and converted with `const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; }`). Add `Dashboard.schedules.*` strings (sq+en).
- [ ] **Step 6: build, commit** `feat: dentist weekly schedules and exceptions`

---

### Task 7: Slot computation (pure)

**Files:** Create `src/lib/slots.ts`, `tests/slots.test.ts`

- [ ] **Step 1: failing tests** — `tests/slots.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeSlots, wallTimeToUtc } from "@/lib/slots";

const TZ = "Europe/Belgrade";
const weekly = [{ weekday: 5, startMin: 540, endMin: 1020 }]; // Fri 09:00–17:00

describe("wallTimeToUtc", () => {
  it("converts winter wall time (CET, +1)", () => {
    expect(wallTimeToUtc("2026-01-16", 540, TZ).toISOString())
      .toBe("2026-01-16T08:00:00.000Z");
  });
  it("converts summer wall time (CEST, +2)", () => {
    expect(wallTimeToUtc("2026-07-17", 540, TZ).toISOString())
      .toBe("2026-07-17T07:00:00.000Z");
  });
});

describe("computeSlots", () => {
  it("generates stepped slots inside the window", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 30, stepMin: 30 });
    expect(slots.length).toBe(16); // 09:00..16:30
    expect(slots[0].startsAt.toISOString()).toBe("2026-07-17T07:00:00.000Z");
    expect(slots.at(-1)!.startsAt.toISOString()).toBe("2026-07-17T14:30:00.000Z");
  });
  it("returns nothing on days without schedule", () => {
    expect(computeSlots({
      dateISO: "2026-07-18", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 30 })).toEqual([]);
  });
  it("removes slots overlapping busy intervals", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [{ startsAt: new Date("2026-07-17T08:00:00Z"),
               endsAt: new Date("2026-07-17T09:00:00Z") }], // 10:00–11:00 wall
      durationMin: 30, stepMin: 30 });
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).not.toContain("2026-07-17T08:00:00.000Z");
    expect(starts).not.toContain("2026-07-17T08:30:00.000Z");
    expect(starts).toContain("2026-07-17T07:30:00.000Z");
    expect(starts).toContain("2026-07-17T09:00:00.000Z");
  });
  it("a slot must FIT inside the window (no 16:45 start for 30min)", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 45, stepMin: 30 });
    expect(slots.at(-1)!.endsAt.toISOString() <= "2026-07-17T15:00:00.000Z").toBe(true);
  });
  it("closed exception wins over weekly", () => {
    expect(computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly,
      exceptions: [{ date: "2026-07-17", closed: true }],
      busy: [], durationMin: 30 })).toEqual([]);
  });
  it("altered-hours exception replaces the weekly window", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly,
      exceptions: [{ date: "2026-07-17", closed: false, startMin: 600, endMin: 720 }],
      busy: [], durationMin: 30, stepMin: 30 });
    expect(slots.length).toBe(4); // 10:00, 10:30, 11:00, 11:30
  });
  it("hides slots before notBefore", () => {
    const slots = computeSlots({
      dateISO: "2026-07-17", timezone: TZ, weekly, exceptions: [],
      busy: [], durationMin: 30, stepMin: 30,
      notBefore: new Date("2026-07-17T12:00:00Z") }); // 14:00 wall
    expect(slots[0].startsAt.toISOString()).toBe("2026-07-17T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: FAIL** → **Step 3: implement** — `src/lib/slots.ts`

```ts
export interface WeeklyEntry { weekday: number; startMin: number; endMin: number }
export interface ExceptionEntry {
  date: string; closed: boolean; startMin?: number | null; endMin?: number | null;
}
export interface BusyInterval { startsAt: Date; endsAt: Date }
export interface Slot { startsAt: Date; endsAt: Date }

export interface ComputeSlotsInput {
  dateISO: string;       // YYYY-MM-DD, clinic-local calendar day
  timezone: string;      // IANA tz of the clinic
  weekly: WeeklyEntry[];
  exceptions: ExceptionEntry[];
  busy: BusyInterval[];
  durationMin: number;
  stepMin?: number;
  notBefore?: Date;
}

/** Offset (ms) of `instant` in `tz`: wall-clock reading minus the instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"),
                             get("hour"), get("minute"), get("second"));
  return wallAsUtc - instant.getTime();
}

/** Converts a clinic-local wall time (date + minutes) to a UTC instant. */
export function wallTimeToUtc(dateISO: string, minutes: number, tz: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // two-pass: estimate offset at the naive instant, then re-check at the result
  let result = naive - tzOffsetMs(new Date(naive), tz);
  result = naive - tzOffsetMs(new Date(result), tz);
  return new Date(result);
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const step = input.stepMin ?? 15;
  const [y, m, d] = input.dateISO.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  const exception = input.exceptions.find((e) => e.date === input.dateISO);
  let windows: { startMin: number; endMin: number }[];
  if (exception) {
    windows = exception.closed
      ? []
      : [{ startMin: exception.startMin!, endMin: exception.endMin! }];
  } else {
    windows = input.weekly.filter((w) => w.weekday === weekday);
  }

  const slots: Slot[] = [];
  for (const w of windows) {
    for (let t = w.startMin; t + input.durationMin <= w.endMin; t += step) {
      const startsAt = wallTimeToUtc(input.dateISO, t, input.timezone);
      const endsAt = wallTimeToUtc(input.dateISO, t + input.durationMin, input.timezone);
      if (input.notBefore && startsAt < input.notBefore) continue;
      const overlapsBusy = input.busy.some(
        (b) => startsAt < b.endsAt && b.startsAt < endsAt);
      if (!overlapsBusy) slots.push({ startsAt, endsAt });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
```

- [ ] **Step 4: PASS** → **Step 5: commit** `feat: pure slot computation library`

---

### Task 8: Clinic settings + final verification

**Files:** Create `src/lib/clinic-settings.ts`, `tests/clinic-settings.test.ts`, `src/app/[locale]/dashboard/settings/page.tsx`

- [ ] **Step 1: failing test** — `tests/clinic-settings.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { direct, truncateAll } from "./helpers/db";
import { updateClinicSettings, SettingsError } from "@/lib/clinic-settings";

let ctx: { userId: string; clinicId: string };

beforeAll(async () => {
  await truncateAll();
  const clinic = await direct.clinic.create({
    data: { slug: "set-klinika", name: "Set", city: "P", address: "x", phone: "x" } });
  const owner = await direct.user.create({
    data: { name: "O", email: "set@x.com", passwordHash: "x" } });
  await direct.membership.create({
    data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  ctx = { userId: owner.id, clinicId: clinic.id };
});
afterAll(async () => { await direct.$disconnect(); });

describe("updateClinicSettings", () => {
  it("updates booking mode and cancellation window", async () => {
    const c = await updateClinicSettings(ctx, {
      bookingMode: "APPROVAL", cancellationWindowHours: 48 });
    expect(c.bookingMode).toBe("APPROVAL");
    expect(c.cancellationWindowHours).toBe(48);
  });
  it("rejects nonsense window", async () => {
    await expect(updateClinicSettings(ctx, { cancellationWindowHours: -1 }))
      .rejects.toThrow(SettingsError);
  });
});
```

- [ ] **Step 2: FAIL** → **Step 3: implement** — `src/lib/clinic-settings.ts`

```ts
import { z } from "zod";
import { withDbContext } from "./tenant-db";

export class SettingsError extends Error {
  constructor(public code: "INVALID_INPUT") { super(code); }
}

const schema = z.object({
  name: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  address: z.string().min(2).optional(),
  phone: z.string().min(8).optional(),
  aboutSq: z.string().optional(),
  aboutEn: z.string().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bookingMode: z.enum(["INSTANT", "APPROVAL"]).optional(),
  cancellationWindowHours: z.number().int().min(0).max(168).optional(),
});

export async function updateClinicSettings(
  ctx: { userId: string; clinicId: string }, input: unknown,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new SettingsError("INVALID_INPUT");
  return withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.clinic.update({ where: { id: ctx.clinicId }, data: parsed.data }));
}
```

- [ ] **Step 4: PASS** → **Step 5: settings page** — form pre-filled from clinic row, one server action calling `updateClinicSettings` (same style as previous pages: text inputs for profile fields, `<select>` for bookingMode, number input for window). Add `Dashboard.settings.*` strings (sq+en).
- [ ] **Step 6: FINAL — full suite + build + smoke**

```powershell
npm run test    # all suites green
npm run build   # clean
# npm run dev → login arta@klinika-arta.dev/demo1234 → walk all dashboard pages
```

- [ ] **Step 7: commit** `feat: clinic settings` → merge via finishing-a-development-branch

---

## Phase 2 exit criteria

- Owner can register a new clinic at `/register`, log in, and see the dashboard
- Services, staff, schedules, and settings all manageable from the dashboard
- `computeSlots` covers: steps, fit-inside-window, busy overlap, closed/altered
  exceptions, notBefore, and CET/CEST conversion — all unit-tested
- Full suite green; RLS still proven by Phase 1 suite
