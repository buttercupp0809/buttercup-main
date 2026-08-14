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
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const file = join(process.cwd(), ".next", "server-env.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string | null>;
    for (const [key, value] of Object.entries(data)) {
      if (value != null && value !== "" && (process.env[key] === undefined || process.env[key] === "")) {
        process.env[key] = value;
      }
    }
  } catch {
    // No baked file (local dev, or platform forwards env directly) - use process.env as-is.
  }
}
