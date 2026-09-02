/**
 * @jest-environment node
 */
// Prisma's generated client (src/generated/prisma) uses `import.meta.url` and
// lazily loads its WASM query compiler via a runtime-only import chain deep
// inside @prisma/client that Jest's CJS-based test runner cannot execute (a
// known Prisma 7 + Jest incompatibility, unrelated to this route's logic —
// `npm test` already exercises the same query engine fine under Vitest).
// The real Postgres write is already covered end-to-end, with no mocking, by
// the Vitest integration test at tests/profile.test.ts. Here we mock the lib
// boundary so this Jest test can verify the route's HTTP contract instead
// (status codes, auth gating, request/response shape).
jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/profile", () => {
  class ProfileError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { updateProfile: jest.fn(), ProfileError };
});

import { PATCH } from "@/app/api/profile/route";
import { auth } from "@/auth";
import { updateProfile, ProfileError } from "@/lib/profile";

describe("PATCH /api/profile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates the authenticated user's profile", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (updateProfile as jest.Mock).mockResolvedValue({ id: "user-1", name: "New Name", locale: "en" });

    const req = new Request("http://localhost/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "New Name", locale: "en" }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: "user-1", name: "New Name", locale: "en" });
    expect(updateProfile).toHaveBeenCalledWith(
      { userId: "user-1" },
      { name: "New Name", locale: "en" },
    );
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const req = new Request("http://localhost/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "X", locale: "en" }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(401);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("returns 400 with the error code when validation fails", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (updateProfile as jest.Mock).mockRejectedValue(new ProfileError("INVALID_INPUT"));

    const req = new Request("http://localhost/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "", locale: "en" }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_INPUT");
  });
});
