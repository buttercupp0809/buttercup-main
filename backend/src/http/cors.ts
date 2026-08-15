// The backend is a plain node:http server that the frontend calls directly
// from the BROWSER (not just server-to-server): BillingClient fetches
// `${NEXT_PUBLIC_BACKEND_URL}/billing/...` with `credentials: "include"` so
// the auth cookie reaches the backend's own cookie-based `authenticate()`,
// and the media/chat-stream routes document the same "client calls the
// backend directly with the same cookie" pattern. Without CORS headers the
// browser blocks every one of those cross-origin (localhost:3000 ->
// localhost:4000) responses before the app code ever sees them, so pages
// like /billing and /upgrade show "Could not load plans" even though the
// backend itself answers fine to curl. There is no framework here (plain
// http.createServer), so CORS has to be applied by hand for every response.
//
// Credentialed cross-origin requests cannot use the "*" wildcard origin, so
// this reflects the request's Origin header, but only when it is on the
// allowlist (CORS_ALLOWED_ORIGINS, comma separated; defaults to the local
// frontend dev origin). This stays additive and local-safe: nothing here
// changes auth, it only lets the browser read responses that already passed
// the existing cookie-based authenticate() check.

const DEFAULT_ORIGINS = ["http://localhost:3000"];

function allowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) return DEFAULT_ORIGINS;
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

// Applies CORS headers to every response when the request Origin is
// allowlisted, and short-circuits OPTIONS preflight requests. Returns true
// when the caller should stop processing (a preflight response was already
// sent); the caller must otherwise continue handling the request as usual,
// with the CORS headers now already attached to `res`.
export function applyCors(req: { method?: string; headers: { origin?: string } }, res: {
  setHeader(name: string, value: string): void;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}): boolean {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return true;
  }
  return false;
}
