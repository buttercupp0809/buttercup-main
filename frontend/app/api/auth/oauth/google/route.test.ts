// Google OAuth route tests. Covers the linking cases (brand-new Google user,
// existing password user linking googleId, returning Google user found by
// googleId) plus the 501/401 guards.
//
// Google users skip the /age-gate screen entirely: the route auto-accepts the
// age/consent gate on their behalf (self-declared age + ToS/Privacy + current
// policy version + a default jurisdiction) and writes an AgeVerification audit
// row, so needsAgeGate is ALWAYS false. An already-cleared returning user is
// left untouched (idempotent, no second audit row).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POLICY_VERSION } from "@/lib/consent";

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const ageVerificationCreate = vi.fn();
const signAuthToken = vi.fn().mockResolvedValue("signed-jwt");
const setAuthCookie = vi.fn();
const jwtVerify = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
    },
    ageVerification: {
      create: (...args: unknown[]) => ageVerificationCreate(...args),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  signAuthToken: (...args: unknown[]) => signAuthToken(...args),
  setAuthCookie: (...args: unknown[]) => setAuthCookie(...args),
}));

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    createRemoteJWKSet: () => ({}),
    jwtVerify: (...args: unknown[]) => jwtVerify(...args),
  };
});

const VALID_ID_TOKEN = "x".repeat(64);

// A user who has already fully cleared the age/consent gate (the same five
// fields needsConsent() checks). Used to prove the returning-user path is
// idempotent: no update, no second audit row.
const CLEARED = {
  ageVerifiedAt: new Date(),
  ageVerificationLevel: "self_declared",
  tosAcceptedAt: new Date(),
  privacyAcceptedAt: new Date(),
  acceptedPolicyVersion: POLICY_VERSION,
};

function req(body: unknown) {
  return new Request("http://localhost/api/auth/oauth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  ageVerificationCreate.mockReset().mockResolvedValue({ id: "av-1" });
  signAuthToken.mockClear();
  setAuthCookie.mockClear();
  jwtVerify.mockReset();
  process.env.GOOGLE_CLIENT_ID = "gcid.apps.googleusercontent.com";
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
});

describe("POST /api/auth/oauth/google", () => {
  it("returns 501 (not 500) when GOOGLE_CLIENT_ID is unset (observable disabled state)", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe("google_oauth_not_configured");
  });

  it("returns 401 when the Google id token verifies but email_verified=false", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-1", email: "u@example.com", email_verified: false, iss: "https://accounts.google.com" },
    });
    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(401);
  });

  it("already-cleared returning Google user signs in untouched (no update, no second audit)", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-1", email: "u@example.com", email_verified: true, iss: "https://accounts.google.com" },
    });
    findUnique.mockImplementation((args: { where: { googleId?: string; email?: string } }) => {
      if (args.where.googleId === "goog-1") return Promise.resolve({ id: "user-1", ...CLEARED });
      return Promise.resolve(null);
    });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(ageVerificationCreate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.userId).toBe("user-1");
    expect(body.needsAgeGate).toBe(false);
    expect(signAuthToken).toHaveBeenCalledWith("user-1");
    expect(setAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("returning Google user not yet cleared (older row) is auto-cleared and audited", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-1", email: "u@example.com", email_verified: true, iss: "https://accounts.google.com" },
    });
    findUnique.mockImplementation((args: { where: { googleId?: string; email?: string } }) => {
      if (args.where.googleId === "goog-1") {
        return Promise.resolve({
          id: "user-1",
          ageVerifiedAt: null,
          ageVerificationLevel: "none",
          tosAcceptedAt: null,
          privacyAcceptedAt: null,
          acceptedPolicyVersion: null,
          emailVerifiedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    update.mockResolvedValue({ id: "user-1" });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const [[callArgs]] = update.mock.calls;
    expect(callArgs.where).toEqual({ id: "user-1" });
    expect(callArgs.data).toMatchObject({
      ageVerificationLevel: "self_declared",
      acceptedPolicyVersion: POLICY_VERSION,
      jurisdiction: "US",
    });
    expect(ageVerificationCreate).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.needsAgeGate).toBe(false);
  });

  it("existing password user is LINKED, auto-cleared, and no longer needs the age gate", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-2", email: "PW@example.com", email_verified: true, iss: "accounts.google.com" },
    });
    findUnique.mockImplementation((args: { where: { googleId?: string; email?: string } }) => {
      if (args.where.googleId === "goog-2") return Promise.resolve(null);
      if (args.where.email === "pw@example.com") {
        return Promise.resolve({
          id: "user-2",
          ageVerifiedAt: null,
          ageVerificationLevel: "none",
          tosAcceptedAt: null,
          privacyAcceptedAt: null,
          acceptedPolicyVersion: null,
          emailVerifiedAt: null,
        });
      }
      return Promise.resolve(null);
    });
    update.mockResolvedValue({ id: "user-2" });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const [[callArgs]] = update.mock.calls;
    expect(callArgs.where).toEqual({ id: "user-2" });
    expect(callArgs.data).toMatchObject({
      googleId: "goog-2",
      oauthProvider: "google",
      ageVerificationLevel: "self_declared",
      acceptedPolicyVersion: POLICY_VERSION,
      jurisdiction: "US",
    });
    // Linking Google to a password user stamps emailVerifiedAt (Google already
    // asserted email_verified above) and the consent timestamps.
    expect(callArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(callArgs.data.tosAcceptedAt).toBeInstanceOf(Date);
    expect(callArgs.data.privacyAcceptedAt).toBeInstanceOf(Date);
    expect(ageVerificationCreate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.needsAgeGate).toBe(false);
  });

  it("brand-new Google user is CREATED, auto-cleared, and needsAgeGate=false", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-3", email: "new@example.com", email_verified: true, iss: "https://accounts.google.com" },
    });
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "user-3" });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const [[createArgs]] = create.mock.calls;
    expect(createArgs.data).toMatchObject({
      email: "new@example.com",
      googleId: "goog-3",
      oauthProvider: "google",
      ageVerificationLevel: "self_declared",
      acceptedPolicyVersion: POLICY_VERSION,
      // Google users skip the age gate, so the jurisdiction is defaulted here
      // (no cf-ipcountry header on the test request), not captured on a screen.
      jurisdiction: "US",
    });
    // DOB is still not set (nullable; no gate reads it), but the consent + age
    // timestamps and email verification are stamped at creation.
    expect(createArgs.data.dob).toBeUndefined();
    expect(createArgs.data.ageVerifiedAt).toBeInstanceOf(Date);
    expect(createArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(ageVerificationCreate).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.userId).toBe("user-3");
    expect(body.needsAgeGate).toBe(false);
  });
});
