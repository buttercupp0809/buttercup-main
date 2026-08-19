// Single source of truth for the app's PUBLIC origin when building emailed
// links and redirect targets from inside route handlers.
//
// WHY THIS EXISTS: in Amplify WEB_COMPUTE (and similar serverless runtimes) the
// URL a route handler sees on `req.url` is the container-internal address, e.g.
// http://localhost:3000/api/auth/verify-email. Building a redirect Location or
// an emailed link from `req.url` therefore leaks localhost into production. This
// is the signup/verify first-run flow, so it must never point at localhost.
//
// Resolution order (first that yields a usable origin wins):
//   1. NEXT_PUBLIC_APP_URL   the configured canonical origin (source of truth)
//   2. x-forwarded-host      the real public host the edge/proxy received the
//                            request on, so we stay correct even if the env var
//                            was never baked into the prod runtime
//   3. req.url origin        local dev, where the host really is localhost
//
// Step 2 is the safety net: even if NEXT_PUBLIC_APP_URL is missing or misbaked
// in prod, a request that arrived through the proxy still resolves to the real
// public host instead of localhost.

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.startsWith("localhost:") ||
    h.startsWith("127.0.0.1") ||
    h.startsWith("[::1]") ||
    h.startsWith("0.0.0.0")
  );
}

export function publicOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const headers = req.headers;
  // x-forwarded-host can be a comma list (chained proxies); take the first.
  const fwdHost = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(",")[0]
    .trim();
  if (fwdHost && !isLocalHost(fwdHost)) {
    const proto =
      (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() || "https";
    return `${proto}://${fwdHost}`;
  }

  return new URL(req.url).origin;
}

// Absolute URL on the public origin for a path such as "/dashboard" or
// "/api/auth/verify-email?token=abc". The path may include a query string.
export function publicUrl(req: Request, path: string): string {
  return new URL(path, publicOrigin(req)).toString();
}
