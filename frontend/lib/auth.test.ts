import { describe, expect, it, beforeAll } from "vitest";
import { SignJWT } from "jose";

beforeAll(() => {
  // Deterministic secret for the test; getSecret() requires >=32 chars.
  process.env.JWT_SECRET =
    process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
      ? process.env.JWT_SECRET
      : "test-secret-please-rotate-me-32chars-min";
});

describe("getSecret", () => {
  it("fails closed on a short secret", async () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "too-short";
    const { getSecret } = await import("./auth");
    expect(() => getSecret()).toThrow(/too short|too_short|32/i);
    process.env.JWT_SECRET = prev;
  });

  it("fails closed on a missing secret", async () => {
    const prev = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    const { getSecret } = await import("./auth");
    expect(() => getSecret()).toThrow(/missing|JWT_SECRET/);
    process.env.JWT_SECRET = prev;
  });
});

describe("auth JWT round-trip", () => {
  it("signs and verifies its own token", async () => {
    const { signAuthToken, verifyAuthToken } = await import("./auth");
    const token = await signAuthToken("user-abc");
    expect(await verifyAuthToken(token)).toBe("user-abc");
  });

  it("rejects a token minted for the wrong audience", async () => {
    const { verifyAuthToken, getSecret } = await import("./auth");
    const wrongAudToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-xyz")
      .setIssuer("buttercupp")
      .setAudience("buttercupp:reset")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(getSecret());
    expect(await verifyAuthToken(wrongAudToken)).toBeNull();
  });

  it("rejects a token signed by a different secret", async () => {
    const { verifyAuthToken } = await import("./auth");
    const foreign = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-xyz")
      .setIssuer("buttercupp")
      .setAudience("buttercupp:auth")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("some-other-secret-that-is-also-32-chars"));
    expect(await verifyAuthToken(foreign)).toBeNull();
  });
});
