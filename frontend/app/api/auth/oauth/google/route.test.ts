// Google OAuth route tests (Phase 32 Part B). Covers the three linking cases:
// brand-new Google user, existing email that signed up with password (link
// googleId), and a returning Google user (found by googleId). Also verifies
// that the route returns 501 when GOOGLE_CLIENT_ID is unset, and that
// needsAgeGate is true for a fresh Google user (they have no dob/jurisdiction
// yet, so they must pass the age gate before reaching mature content).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
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

  it("returning Google user (found by googleId) signs in without linking", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-1", email: "u@example.com", email_verified: true, iss: "https://accounts.google.com" },
    });
    findUnique.mockImplementation((args: { where: { googleId?: string; email?: string } }) => {
      if (args.where.googleId === "goog-1") {
        return Promise.resolve({ id: "user-1", ageVerifiedAt: new Date(), ageVerificationLevel: "self_declared" });
      }
      return Promise.resolve(null);
    });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.userId).toBe("user-1");
    expect(body.needsAgeGate).toBe(false);
    expect(signAuthToken).toHaveBeenCalledWith("user-1");
    expect(setAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("existing email/password user is LINKED (googleId set) and gets a session", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-2", email: "PW@example.com", email_verified: true, iss: "accounts.google.com" },
    });
    findUnique.mockImplementation((args: { where: { googleId?: string; email?: string } }) => {
      if (args.where.googleId === "goog-2") return Promise.resolve(null);
      if (args.where.email === "pw@example.com") {
        return Promise.resolve({ id: "user-2", ageVerifiedAt: null, ageVerificationLevel: "none" });
      }
      return Promise.resolve(null);
    });
    update.mockResolvedValue({ id: "user-2", ageVerifiedAt: null, ageVerificationLevel: "none" });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const [[callArgs]] = update.mock.calls;
    expect(callArgs.where).toEqual({ id: "user-2" });
    expect(callArgs.data).toMatchObject({ googleId: "goog-2", oauthProvider: "google" });
    // Phase 34 Feature C: linking Google to an existing password user must
    // stamp emailVerifiedAt (Google already asserted email_verified above).
    expect(callArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(create).not.toHaveBeenCalled();
    const body = await res.json();
    // Fresh (unverified) user must be routed through the age gate.
    expect(body.needsAgeGate).toBe(true);
  });

  it("brand-new Google user is CREATED and needsAgeGate=true (dob/jurisdiction still unknown)", async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: "goog-3", email: "new@example.com", email_verified: true, iss: "https://accounts.google.com" },
    });
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "user-3", ageVerifiedAt: null, ageVerificationLevel: "none" });

    const { POST } = await import("./route");
    const res = await POST(req({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const [[createArgs]] = create.mock.calls;
    expect(createArgs.data).toMatchObject({
      email: "new@example.com",
      googleId: "goog-3",
      oauthProvider: "google",
    });
    // No dob / no jurisdiction set at creation: the age gate captures those.
    expect(createArgs.data.dob).toBeUndefined();
    expect(createArgs.data.jurisdiction).toBeUndefined();
    // Phase 34 Feature C: a brand-new Google signup must be auto-verified.
    expect(createArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    const body = await res.json();
    expect(body.userId).toBe("user-3");
    expect(body.needsAgeGate).toBe(true);
  });
});
