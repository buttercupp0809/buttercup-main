// Phase 34 Feature C: signup route sends a verification email with a token
// link and does NOT stamp emailVerifiedAt. The user is created (unverified)
// and issued an auth cookie so they can reach /verify-email to resend.

import { describe, expect, it, vi, beforeEach } from "vitest";

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const ageVerificationCreate = vi.fn();
const sendEmail = vi.fn();
const issueEmailVerification = vi.fn();
const signAuthToken = vi.fn().mockResolvedValue("jwt");
const setAuthCookie = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      create: (...a: unknown[]) => userCreate(...a),
    },
    ageVerification: {
      create: (...a: unknown[]) => ageVerificationCreate(...a),
    },
  },
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
}));

vi.mock("@/lib/auth", () => ({
  signAuthToken: (...a: unknown[]) => signAuthToken(...a),
  setAuthCookie: (...a: unknown[]) => setAuthCookie(...a),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  emailShell: (_t: string, b: string) => b,
}));

vi.mock("@/lib/email-verify", () => ({
  issueEmailVerification: (...a: unknown[]) => issueEmailVerification(...a),
}));

function req(body: unknown) {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  email: "new@example.com",
  password: "Sup3rSecret!pw",
  // 30 years ago, comfortably past MIN_AGE_YEARS.
  dob: new Date(Date.now() - 30 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  jurisdiction: "US",
  tosAccepted: true,
  privacyAccepted: true,
};

beforeEach(() => {
  userFindUnique.mockReset();
  userCreate.mockReset();
  ageVerificationCreate.mockReset().mockResolvedValue({});
  sendEmail.mockReset().mockResolvedValue({ ok: true });
  issueEmailVerification.mockReset().mockResolvedValue({
    rawToken: "rawtokenabc123",
    expiresAt: new Date(Date.now() + 1000),
    linkId: "link-1",
  });
  signAuthToken.mockClear();
  setAuthCookie.mockClear();
});

describe("POST /api/auth/signup (Phase 34 Feature C)", () => {
  it("creates an unverified user and sends a verification email with a token link", async () => {
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "user-new", email: VALID_BODY.email });

    const { POST } = await import("./route");
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);

    expect(userCreate).toHaveBeenCalledTimes(1);
    const [[createArgs]] = userCreate.mock.calls;
    // Must NOT stamp emailVerifiedAt on password signup.
    expect(createArgs.data.emailVerifiedAt).toBeUndefined();

    expect(issueEmailVerification).toHaveBeenCalledWith("user-new", VALID_BODY.email);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [[sendArgs]] = sendEmail.mock.calls;
    expect(sendArgs.to).toBe(VALID_BODY.email);
    expect(sendArgs.html).toContain(
      "/api/auth/verify-email?token=rawtokenabc123",
    );
    expect(sendArgs.text).toContain("rawtokenabc123");

    expect(setAuthCookie).toHaveBeenCalledTimes(1);
  });
});
