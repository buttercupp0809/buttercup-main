import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin, publicUrl } from "./public-url";

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
});

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("publicOrigin", () => {
  it("uses NEXT_PUBLIC_APP_URL when set, stripping trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://buttercupp.fun/";
    expect(publicOrigin(req("http://localhost:3000/api/x"))).toBe("https://buttercupp.fun");
  });

  it("falls back to x-forwarded-host when the env var is unset (prod safety net)", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const r = req("http://localhost:3000/api/x", {
      "x-forwarded-host": "buttercupp.fun",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(r)).toBe("https://buttercupp.fun");
  });

  it("defaults the proto to https when only the forwarded host is present", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const r = req("http://localhost:3000/api/x", { "x-forwarded-host": "app.buttercupp.fun" });
    expect(publicOrigin(r)).toBe("https://app.buttercupp.fun");
  });

  it("ignores a localhost host header and uses req.url origin in local dev", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(publicOrigin(req("http://localhost:3000/api/x"))).toBe("http://localhost:3000");
  });

  it("takes the first host from a chained x-forwarded-host list", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const r = req("http://localhost:3000/api/x", {
      "x-forwarded-host": "buttercupp.fun, internal-proxy.local",
    });
    expect(publicOrigin(r)).toBe("https://buttercupp.fun");
  });
});

describe("publicUrl", () => {
  it("builds an absolute URL on the public origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://buttercupp.fun";
    expect(publicUrl(req("http://localhost:3000/x"), "/dashboard")).toBe(
      "https://buttercupp.fun/dashboard",
    );
  });

  it("preserves query strings on the path", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://buttercupp.fun";
    expect(publicUrl(req("http://localhost:3000/x"), "/verify-email?error=expired")).toBe(
      "https://buttercupp.fun/verify-email?error=expired",
    );
  });

  it("does not emit localhost when env is unset but the request arrived via a proxy", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const r = req("http://localhost:3000/api/auth/verify-email?token=t", {
      "x-forwarded-host": "buttercupp.fun",
    });
    expect(publicUrl(r, "/dashboard")).toBe("https://buttercupp.fun/dashboard");
  });
});
