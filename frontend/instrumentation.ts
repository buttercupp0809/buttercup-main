// Amplify SSR environment bridge.
//
// Amplify's Next.js compute runtime does not reliably forward the app's
// console environment variables to the server process. The amplify.yml build
// step bakes the needed values into `.next/server-env.json`; here we load that
// file once at server startup (Next.js runs `register()` before handling any
// request) and fill in any process.env keys that are missing or empty.
//
// Real process.env ALWAYS wins: the baked file is a fallback only, so local dev
// and any platform that does forward env vars are unaffected. This is what lets
// server-only reads (Prisma DATABASE_URL, JWT_SECRET, CloudFront URL signing in
// lib/cdn.ts) work once deployed to Amplify.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    // webpackIgnore: webpack skips these imports during bundling (they fail
    // in the edge runtime pass). Node resolves them natively at runtime.
    const { readFileSync, existsSync } = await import(/* webpackIgnore: true */ "fs");
    const { join } = await import(/* webpackIgnore: true */ "path");
    const cwd = process.cwd();
    // Try multiple candidate paths for server-env.json. In Amplify WEB_COMPUTE
    // the artifact baseDirectory is `.next`, so the Lambda root might be the
    // .next contents themselves (no .next sub-dir), or it might be the frontend
    // root with .next as a sub-dir. Try both so the bridge works either way.
    const candidates = [
      join(cwd, ".next", "server-env.json"),
      join(cwd, "server-env.json"),
      join(cwd, "..", ".next", "server-env.json"),
    ];
    let data: Record<string, string | null> | null = null;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        data = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, string | null>;
        break;
      }
    }
    if (!data) return;
    for (const [key, value] of Object.entries(data)) {
      if (value != null && value !== "" && (process.env[key] === undefined || process.env[key] === "")) {
        process.env[key] = value;
      }
    }
  } catch {
    // No baked file (local dev, or platform forwards env directly) - use process.env as-is.
  }
}
