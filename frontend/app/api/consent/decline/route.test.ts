import { describe, expect, it } from "vitest";
import { AUTH_COOKIE } from "@/lib/constants";

describe("POST /api/consent/decline", () => {
  it("clears the auth cookie (maxAge 0) and returns a redirect to /login", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ ok: true, redirect: "/login" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${AUTH_COOKIE}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
