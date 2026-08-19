// Phase 34 Feature C: requireEmailVerified() bounces unverified password
// users to /verify-email but passes verified users AND any Google user
// (oauthProvider="google" or googleId set) even if emailVerifiedAt is null,
// so an older Google row not yet backfilled cannot be locked out.

import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

const userFindUnique = vi.fn();
const redirect = vi.fn((_: string) => {
  throw new Error("__REDIRECT__");
});
const cookiesGet = vi.fn();

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-please-rotate-me-32chars-min";
});

vi.mock("@buttercupp/database", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookiesGet(name),
  }),
}));

function mockAuthed(userId: string) {
  // Return any truthy cookie; we mock verifyAuthToken indirectly via the
  // module by making getCurrentUser resolve through prisma. The simplest is
  // to also mock verifyAuthToken. Instead, stub the cookie with a real JWT
  // by importing signAuthToken from the module under test after configuring
  // the secret. To keep this test hermetic, we instead sign a token here.
  cookiesGet.mockImplementation((name: string) =>
    name === "buttercupp_auth" ? { value: `signed-for-${userId}` } : undefined,
  );
}

// Override verifyAuthToken by mocking jose's jwtVerify.
vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    jwtVerify: async (token: string) => {
      const m = /signed-for-(.+)$/.exec(token);
      if (!m) throw new Error("bad");
      return { payload: { sub: m[1] } };
    },
  };
});

beforeEach(() => {
  userFindUnique.mockReset();
  redirect.mockClear();
  cookiesGet.mockReset();
});

describe("requireEmailVerified", () => {
  it("redirects an unverified password user to /verify-email", async () => {
    mockAuthed("user-pw");
    userFindUnique.mockResolvedValue({
      id: "user-pw",
      email: "pw@example.com",
      emailVerifiedAt: null,
      oauthProvider: null,
      googleId: null,
    });
    const { requireEmailVerified } = await import("./auth");
    await expect(requireEmailVerified()).rejects.toThrow("__REDIRECT__");
    expect(redirect).toHaveBeenCalledWith("/verify-email");
  });

  it("passes a verified password user through", async () => {
    mockAuthed("user-pw2");
    userFindUnique.mockResolvedValue({
      id: "user-pw2",
      email: "pw2@example.com",
      emailVerifiedAt: new Date(),
      oauthProvider: null,
      googleId: null,
    });
    const { requireEmailVerified } = await import("./auth");
    const user = await requireEmailVerified();
    expect(user.id).toBe("user-pw2");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("passes a Google user even when emailVerifiedAt is null", async () => {
    mockAuthed("user-goog");
    userFindUnique.mockResolvedValue({
      id: "user-goog",
      email: "g@example.com",
      emailVerifiedAt: null,
      oauthProvider: "google",
      googleId: "goog-sub-1",
    });
    const { requireEmailVerified } = await import("./auth");
    const user = await requireEmailVerified();
    expect(user.id).toBe("user-goog");
    expect(redirect).not.toHaveBeenCalled();
  });
});
