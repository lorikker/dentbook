# MongoDB Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MongoDB slice (via Mongoose) to dentbook with three models — `ContactMessage`, `ActivityLog`, `Testimonial` — scoped to data that is not tenant-sensitive, satisfying rubric §5 (MongoDB, 3+ models) without touching the Postgres/Prisma/RLS system that remains the source of truth for clinic/booking data.

**Architecture:** A single cached Mongoose connection (`src/lib/mongo.ts`), mirroring the existing `globalThis`-cached-client pattern in `src/lib/db.ts`. Each model lives in its own file under `src/lib/models/`. Tests run against a real MongoDB engine spun up in-process via `mongodb-memory-server` (no mocking), following this project's existing convention of testing against real infrastructure (see `tests/services.test.ts`, which hits a real Postgres test database).

**Tech Stack:** Mongoose 9.9.4, mongodb-memory-server 11.2.0 (dev dependency, test-only), Vitest (existing test runner).

## Global Constraints

- PostgreSQL + Prisma remains the source of truth for all tenant/clinic data; RLS enforcement must never be duplicated or bypassed in Mongo — see design doc §6.
- The three Mongo models are exactly `ContactMessage`, `ActivityLog`, `Testimonial` — no others, and none may store tenant-sensitive data (clinic financials, patient PII beyond what a contact form submitter volunteers).
- Tests hit real infrastructure, not mocks — this project's existing tests (e.g. `tests/services.test.ts`) hit a real Postgres test database; the Mongo tests here must equivalently hit a real (in-memory) MongoDB engine.
- Follow the existing `globalThis`-cached-singleton pattern for external clients, established in `src/lib/db.ts`.
- Do not commit `.env.local` or secrets to git (rubric §12).
- Commit source and test changes normally at the end of each task. Do NOT commit anything under `docs/` — the design spec and this plan stay uncommitted per user instruction.

---

### Task 1: Mongo connection singleton + test harness wiring

**Files:**
- Modify: `package.json` (add `mongoose` dependency, `mongodb-memory-server` dev dependency)
- Create: `src/lib/mongo.ts`
- Modify: `tests/helpers/global-setup.ts`
- Modify: `tests/helpers/setup-env.ts`
- Test: `tests/mongo-connection.test.ts`

**Interfaces:**
- Produces: `connectMongo(): Promise<typeof mongoose>` — exported from `src/lib/mongo.ts`. Every later task's model files and tests import this to ensure a connection exists before querying.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install mongoose@9.9.4
npm install --save-dev mongodb-memory-server@11.2.0
```

- [ ] **Step 2: Extend the global test setup to start an in-memory MongoDB and provide its URI**

Replace the full contents of `tests/helpers/global-setup.ts` with:

```ts
import { execSync } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";
import "dotenv/config";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup({ provide }: TestProject) {
  // prisma.config.ts reads DIRECT_DATABASE_URL; point it at the test DB.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: process.env.TEST_DIRECT_DATABASE_URL,
    },
  });

  const mongod = await MongoMemoryServer.create();
  provide("mongoUri", mongod.getUri());

  return async () => {
    await mongod.stop();
  };
}
```

Note: the first run downloads a MongoDB server binary (~100MB) into a local cache; this can take a minute and requires network access. Subsequent runs reuse the cached binary.

- [ ] **Step 3: Inject the Mongo URI into the per-file test environment**

Replace the full contents of `tests/helpers/setup-env.ts` with:

```ts
import "dotenv/config";
import { inject } from "vitest";

// setupFiles run before test-file imports, so modules that construct Prisma
// clients at import time (src/lib/db.ts) pick up the test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL;
process.env.MONGODB_URI = inject("mongoUri");
```

- [ ] **Step 4: Write the failing test**

Create `tests/mongo-connection.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";

describe("connectMongo", () => {
  afterAll(async () => {
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("connects to the test Mongo instance", async () => {
    const conn = await connectMongo();
    expect(conn.connection.readyState).toBe(1);
  });
});
```

- [ ] **Step 5: Run the test and verify it fails**

Run: `npx vitest run tests/mongo-connection.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mongo'` (the file doesn't exist yet).

- [ ] **Step 6: Write the minimal implementation**

Create `src/lib/mongo.ts`:

```ts
import mongoose from "mongoose";

const globalForMongo = globalThis as unknown as {
  mongoConn?: Promise<typeof mongoose>;
};

/** Cached Mongoose connection. All Mongo-backed models share this. */
export function connectMongo(): Promise<typeof mongoose> {
  if (!globalForMongo.mongoConn) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI is not set");
    }
    globalForMongo.mongoConn = mongoose.connect(uri);
  }
  return globalForMongo.mongoConn;
}
```

- [ ] **Step 7: Run the test and verify it passes**

Run: `npx vitest run tests/mongo-connection.test.ts`
Expected: PASS (1 test)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/mongo.ts tests/helpers/global-setup.ts tests/helpers/setup-env.ts tests/mongo-connection.test.ts
git commit -m "feat: add Mongo connection singleton and wire it into the test harness"
```

---

### Task 2: ContactMessage model

**Files:**
- Create: `src/lib/models/contact-message.ts`
- Test: `tests/contact-message.test.ts`

**Interfaces:**
- Consumes: `connectMongo()` from `src/lib/mongo.ts` (Task 1).
- Produces: `ContactMessage` (Mongoose model) and `ContactMessageDoc` (type) — exported from `src/lib/models/contact-message.ts`. The Contact page form handler (a later plan) creates documents via `ContactMessage.create(...)`.

- [ ] **Step 1: Write the failing test**

Create `tests/contact-message.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { ContactMessage } from "@/lib/models/contact-message";

describe("ContactMessage", () => {
  afterAll(async () => {
    await connectMongo();
    await ContactMessage.deleteMany({});
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("saves a contact message", async () => {
    await connectMongo();
    const msg = await ContactMessage.create({
      name: "Arta",
      email: "arta@example.com",
      message: "Hello, I have a question.",
    });
    expect(msg.name).toBe("Arta");
    expect(msg.email).toBe("arta@example.com");
    expect(msg.message).toBe("Hello, I have a question.");
  });

  it("rejects a message missing a required field", async () => {
    await connectMongo();
    await expect(
      ContactMessage.create({ name: "Arta", message: "Hello" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/contact-message.test.ts`
Expected: FAIL — `Cannot find module '@/lib/models/contact-message'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/models/contact-message.ts`:

```ts
import { Schema, model, models, type InferSchemaType } from "mongoose";

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

export type ContactMessageDoc = InferSchemaType<typeof contactMessageSchema>;

export const ContactMessage =
  models.ContactMessage ?? model("ContactMessage", contactMessageSchema);
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/contact-message.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/models/contact-message.ts tests/contact-message.test.ts
git commit -m "feat: add ContactMessage Mongo model"
```

---

### Task 3: ActivityLog model and logActivity helper

**Files:**
- Create: `src/lib/models/activity-log.ts`
- Test: `tests/activity-log.test.ts`

**Interfaces:**
- Consumes: `connectMongo()` from `src/lib/mongo.ts` (Task 1).
- Produces: `ActivityLog` (Mongoose model), `ActivityLogDoc` (type), and `logActivity(type: string, message: string, metadata?: Record<string, unknown>): Promise<void>` — exported from `src/lib/models/activity-log.ts`. A later plan (Admin panel + OAuth roles) calls `logActivity` from existing server actions (registration, booking, cancellation, clinic approval) and reads `ActivityLog` to render the Admin Panel's activity feed.

- [ ] **Step 1: Write the failing test**

Create `tests/activity-log.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { ActivityLog, logActivity } from "@/lib/models/activity-log";

describe("logActivity", () => {
  afterAll(async () => {
    await connectMongo();
    await ActivityLog.deleteMany({});
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("records an activity entry with metadata", async () => {
    await logActivity("booking_created", "Arta booked at Smile Clinic", {
      clinicId: "clinic-1",
      appointmentId: "appt-1",
    });
    const entries = await ActivityLog.find({ type: "booking_created" });
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("Arta booked at Smile Clinic");
    expect(entries[0].metadata).toEqual({
      clinicId: "clinic-1",
      appointmentId: "appt-1",
    });
  });

  it("records an activity entry without metadata", async () => {
    await logActivity("clinic_approved", "Smile Clinic was approved");
    const entries = await ActivityLog.find({ type: "clinic_approved" });
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/activity-log.test.ts`
Expected: FAIL — `Cannot find module '@/lib/models/activity-log'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/models/activity-log.ts`:

```ts
import { Schema, model, models, type InferSchemaType } from "mongoose";
import { connectMongo } from "@/lib/mongo";

const activityLogSchema = new Schema(
  {
    type: { type: String, required: true },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: true },
);

export type ActivityLogDoc = InferSchemaType<typeof activityLogSchema>;

export const ActivityLog =
  models.ActivityLog ?? model("ActivityLog", activityLogSchema);

/** Records a platform event for the Admin Panel's activity feed. */
export async function logActivity(
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await connectMongo();
  await ActivityLog.create({ type, message, metadata });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/activity-log.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/models/activity-log.ts tests/activity-log.test.ts
git commit -m "feat: add ActivityLog Mongo model and logActivity helper"
```

---

### Task 4: Testimonial model

**Files:**
- Create: `src/lib/models/testimonial.ts`
- Test: `tests/testimonial.test.ts`

**Interfaces:**
- Consumes: `connectMongo()` from `src/lib/mongo.ts` (Task 1).
- Produces: `Testimonial` (Mongoose model) and `TestimonialDoc` (type) — exported from `src/lib/models/testimonial.ts`. A later plan (Admin panel) moderates (`published` field) and a later plan (Home/About pages) reads published testimonials.

- [ ] **Step 1: Write the failing test**

Create `tests/testimonial.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { connectMongo } from "@/lib/mongo";
import { Testimonial } from "@/lib/models/testimonial";

describe("Testimonial", () => {
  afterAll(async () => {
    await connectMongo();
    await Testimonial.deleteMany({});
    const conn = await connectMongo();
    await conn.disconnect();
  });

  it("defaults to unpublished", async () => {
    await connectMongo();
    const t = await Testimonial.create({
      authorName: "Blerta",
      quote: "Great clinic, very professional staff!",
    });
    expect(t.published).toBe(false);
  });

  it("can be published", async () => {
    await connectMongo();
    const t = await Testimonial.create({
      authorName: "Dren",
      quote: "Booking was fast and easy.",
    });
    t.published = true;
    await t.save();
    const reloaded = await Testimonial.findById(t._id);
    expect(reloaded?.published).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/testimonial.test.ts`
Expected: FAIL — `Cannot find module '@/lib/models/testimonial'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/models/testimonial.ts`:

```ts
import { Schema, model, models, type InferSchemaType } from "mongoose";

const testimonialSchema = new Schema(
  {
    authorName: { type: String, required: true, trim: true },
    quote: { type: String, required: true, trim: true },
    role: { type: String, required: false, trim: true },
    photoUrl: { type: String, required: false, trim: true },
    published: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export type TestimonialDoc = InferSchemaType<typeof testimonialSchema>;

export const Testimonial =
  models.Testimonial ?? model("Testimonial", testimonialSchema);
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/testimonial.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/models/testimonial.ts tests/testimonial.test.ts
git commit -m "feat: add Testimonial Mongo model"
```

---

### Task 5: Document environment variables and verify the full suite

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing new — this task only documents and verifies Tasks 1–4.

- [ ] **Step 1: Add MONGODB_URI to the example env file**

In `.env.example`, after the existing `SMS_PROVIDER="console"` line, add:

```
# MongoDB connection (ContactMessage, ActivityLog, Testimonial). Not needed
# for tests — those spin up an in-memory MongoDB automatically.
MONGODB_URI="mongodb://localhost:27017/dentbook"
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: All tests pass, including the 4 new Postgres-untouched Mongo test files (`tests/mongo-connection.test.ts`, `tests/contact-message.test.ts`, `tests/activity-log.test.ts`, `tests/testimonial.test.ts`) alongside every existing test.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: document MONGODB_URI in .env.example"
```
