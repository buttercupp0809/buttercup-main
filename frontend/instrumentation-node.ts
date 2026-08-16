// Amplify SSR environment bridge (Node runtime only).
//
// This file is only loaded by Next.js under the Node.js runtime (never edge),
// so we can use fs/path directly. See docs:
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// Amplify's Next.js compute runtime does not reliably forward the app's
// console environment variables to the server process. The amplify.yml build
// step bakes the needed values into `.next/server-env.json`; we load that file
// once at server startup and fill in any process.env keys that are missing or
// empty.
//
// Real process.env ALWAYS wins: the baked file is a fallback only, so local
// dev and any platform that does forward env vars are unaffected.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function register(): Promise<void> {
  try {
    const cwd = process.cwd();
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
    // No baked file (local dev, or platform forwards env directly).
  }
}
