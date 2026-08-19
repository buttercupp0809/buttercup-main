// Proves the post-verification redirect lands on the PUBLIC origin, not the
// container-internal localhost that req.url carries behind the Amplify proxy.
// This is the first-run signup flow, so localhost here breaks every new user.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consumeEmailVerification = vi.fn();

vi.mock("@/lib/email-verify", () => ({
  consumeEmailVerification: (...a: unknown[]) => consumeEmailVerification(...a),
}));

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  consumeEmailVerification.mockReset();
});

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

// The token link is clicked from the user's inbox, so the request arrives on
// the public host and the proxy sets x-forwarded-host. req.url is the internal
// localhost address.
function clickReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/auth/verify-email?token=tok123", {
    headers,
  });
}

describe("GET /api/auth/verify-email", () => {
  it("redirects a verified user to the PUBLIC origin from NEXT_PUBLIC_APP_URL, never localhost", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://buttercupp.fun";
    consumeEmailVerification.mockResolvedValue({ ok: true });

    const { GET } = await import("./route");
    const res = await GET(clickReq());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://buttercupp.fun/dashboard");
    expect(res.headers.get("location")).not.toContain("localhost");
  });

  it("falls back to the proxy forwarded host when the env var is missing (never localhost)", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    consumeEmailVerification.mockResolvedValue({ ok: true });

    const { GET } = await import("./route");
    const res = await GET(clickReq({ "x-forwarded-host": "buttercupp.fun", "x-forwarded-proto": "https" }));

    expect(res.headers.get("location")).toBe("https://buttercupp.fun/dashboard");
    expect(res.headers.get("location")).not.toContain("localhost");
  });

  it("sends an invalid token back to /verify-email on the public origin with the error code", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://buttercupp.fun";
    consumeEmailVerification.mockResolvedValue({ ok: false, reason: "expired" });

    const { GET } = await import("./route");
    const res = await GET(clickReq());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://buttercupp.fun/verify-email?error=expired");
  });
});
