// Phase 34 Feature C: email-verify token issue/consume unit tests. Mocks the
// prisma singleton so no DB is required. Covers the three failure modes
// (invalid short token, expired, already used) and the happy path where
// consume() both stamps the MagicLink row consumed AND flips the User's
// emailVerifiedAt to now(). Also verifies that issue() invalidates prior
// unconsumed email-verify links so only one live token exists per user.

import { describe, expect, it, vi, beforeEach } from "vitest";

const magicLinkCreate = vi.fn();
const magicLinkFindUnique = vi.fn();
const magicLinkUpdateMany = vi.fn();
const userUpdate = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    magicLink: {
      create: (...args: unknown[]) => magicLinkCreate(...args),
      findUnique: (...args: unknown[]) => magicLinkFindUnique(...args),
      updateMany: (...args: unknown[]) => magicLinkUpdateMany(...args),
    },
    user: {
      update: (...args: unknown[]) => userUpdate(...args),
    },
  },
}));

beforeEach(() => {
  magicLinkCreate.mockReset();
  magicLinkFindUnique.mockReset();
  magicLinkUpdateMany.mockReset();
  userUpdate.mockReset();
});

describe("issueEmailVerification", () => {
  it("invalidates prior unconsumed email-verify tokens and creates a fresh row", async () => {
    magicLinkUpdateMany.mockResolvedValue({ count: 2 });
    magicLinkCreate.mockResolvedValue({ id: "link-1" });

    const { issueEmailVerification, EMAIL_VERIFY_PURPOSE } = await import("./email-verify");
    const out = await issueEmailVerification("user-1", "u@example.com");

    expect(out.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(out.linkId).toBe("link-1");
    expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 23 * 1000);

    expect(magicLinkUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", purpose: EMAIL_VERIFY_PURPOSE, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });

    expect(magicLinkCreate).toHaveBeenCalledTimes(1);
    const [createArgs] = magicLinkCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(createArgs.data.userId).toBe("user-1");
    expect(createArgs.data.purpose).toBe(EMAIL_VERIFY_PURPOSE);
    expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createArgs.data.tokenHash).not.toBe(out.rawToken);
  });
});

describe("consumeEmailVerification", () => {
  it("stamps emailVerifiedAt on a valid token", async () => {
    const rawToken = "a".repeat(64);
    magicLinkFindUnique.mockResolvedValue({
      id: "link-1",
      userId: "user-1",
      purpose: "email-verify",
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: "irrelevant",
    });
    magicLinkUpdateMany.mockResolvedValue({ count: 1 });
    userUpdate.mockResolvedValue({});

    const { consumeEmailVerification } = await import("./email-verify");
    const res = await consumeEmailVerification(rawToken);

    expect(res.ok).toBe(true);
    expect(res.userId).toBe("user-1");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerifiedAt: expect.any(Date) },
    });
  });

  it("rejects an expired token and does NOT touch the user row", async () => {
    magicLinkFindUnique.mockResolvedValue({
      id: "link-2",
      userId: "user-2",
      purpose: "email-verify",
      consumedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      tokenHash: "irrelevant",
    });

    const { consumeEmailVerification } = await import("./email-verify");
    const res = await consumeEmailVerification("b".repeat(64));

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("expired");
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects an already-consumed token", async () => {
    magicLinkFindUnique.mockResolvedValue({
      id: "link-3",
      userId: "user-3",
      purpose: "email-verify",
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: "irrelevant",
    });

    const { consumeEmailVerification } = await import("./email-verify");
    const res = await consumeEmailVerification("c".repeat(64));

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("already_used");
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects a short/garbage token without hitting the DB", async () => {
    const { consumeEmailVerification } = await import("./email-verify");
    const res = await consumeEmailVerification("x");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("invalid");
    expect(magicLinkFindUnique).not.toHaveBeenCalled();
  });
});
