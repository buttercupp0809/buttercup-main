import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthUserId = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/auth", () => ({ getAuthUserId }));
vi.mock("@buttercupp/database", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

function req(body: unknown) {
  return new Request("http://localhost/api/consent/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  policyVersion: "2026-08-15",
  tosAccepted: true,
  privacyAccepted: true,
  ageConfirmed: true,
};

beforeEach(() => {
  getAuthUserId.mockReset();
  findUnique.mockReset();
  update.mockReset();
});

describe("POST /api/consent/accept", () => {
  it("returns 401 when there is no authenticated user", async () => {
    getAuthUserId.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 409 stale_policy_version when the submitted version does not match POLICY_VERSION", async () => {
    getAuthUserId.mockResolvedValue("user-1");
    const { POST } = await import("./route");
    const res = await POST(req({ ...validBody, policyVersion: "2000-01-01" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("stale_policy_version");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a payload with any box false at the Zod boundary", async () => {
    getAuthUserId.mockResolvedValue("user-1");
    const { POST } = await import("./route");
    const res = await POST(req({ ...validBody, tosAccepted: false }));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("records consentAcceptedAt + acceptedPolicyVersion + tos/privacy stamps on success", async () => {
    getAuthUserId.mockResolvedValue("user-1");
    findUnique.mockResolvedValue({ ageVerifiedAt: new Date("2020-01-01") });
    update.mockResolvedValue({});
    const { POST } = await import("./route");
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const [[callArgs]] = update.mock.calls;
    expect(callArgs.where).toEqual({ id: "user-1" });
    expect(callArgs.data.acceptedPolicyVersion).toBe("2026-08-15");
    expect(callArgs.data.consentAcceptedAt).toBeInstanceOf(Date);
    expect(callArgs.data.tosAcceptedAt).toBeInstanceOf(Date);
    expect(callArgs.data.privacyAcceptedAt).toBeInstanceOf(Date);
    // Already age-verified: must NOT stamp ageVerifiedAt/ageVerificationLevel again.
    expect(callArgs.data.ageVerifiedAt).toBeUndefined();
    expect(callArgs.data.ageVerificationLevel).toBeUndefined();
  });

  it("stamps ageVerifiedAt + ageVerificationLevel = self_declared when the user never passed the age gate", async () => {
    getAuthUserId.mockResolvedValue("user-2");
    findUnique.mockResolvedValue({ ageVerifiedAt: null });
    update.mockResolvedValue({});
    const { POST } = await import("./route");
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const [[callArgs]] = update.mock.calls;
    expect(callArgs.data.ageVerifiedAt).toBeInstanceOf(Date);
    expect(callArgs.data.ageVerificationLevel).toBe("self_declared");
  });
});
