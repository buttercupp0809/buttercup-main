import { beforeAll, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE } from "@/lib/constants";

beforeAll(() => {
  // clearAuthCookie is imported transitively via the route; getSecret() is not
  // invoked here, but keep parity with lib/auth.test.ts to avoid surprises if
  // module-load side effects change later.
  process.env.JWT_SECRET =
    process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
      ? process.env.JWT_SECRET
      : "test-secret-please-rotate-me-32chars-min";
});

function makeReq(method: "GET" | "POST"): NextRequest {
  // The route only reads req.url (to build the /login redirect target) and
  // req.method conceptually via the handler dispatch, so a minimal Request
  // shim cast to NextRequest is enough. We include the auth cookie header so
  // the assertion "response clears the cookie regardless of what the request
  // carried" is honest.
  const req = new Request("https://example.test/logout", {
    method,
    headers: { cookie: `${AUTH_COOKIE}=fake.jwt.value` },
  });
  return req as unknown as NextRequest;
}

describe("/logout route", () => {
  it("GET redirects to /login and clears the auth cookie (Max-Age=0)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.test/login");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${AUTH_COOKIE}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });

  it("POST redirects to /login (303 so the follow-up is GET) and clears the cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq("POST"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.test/login");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${AUTH_COOKIE}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
