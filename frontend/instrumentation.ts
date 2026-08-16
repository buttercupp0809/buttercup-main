export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Load env vars baked into .next/server-env.json during the Amplify build.
    // Uses dynamic import to keep Node builtins out of the edge bundle.
    const fs = await import("fs");
    const path = await import("path");
    const candidates = [
      path.join(process.cwd(), ".next", "server-env.json"),
      path.join(process.cwd(), "server-env.json"),
      "/var/task/.next/server-env.json",
    ];
    let loaded = false;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const vars = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
          let count = 0;
          for (const [k, v] of Object.entries(vars)) {
            if (typeof v === "string" && v && !process.env[k]) {
              process.env[k] = v;
              count++;
            }
          }
          console.log(`[instrumentation] Loaded ${count} env vars from ${p}`);
          loaded = true;
          break;
        } catch (err) {
          console.error(`[instrumentation] Failed to parse ${p}:`, err);
        }
      }
    }
    if (!loaded) {
      console.warn(
        "[instrumentation] server-env.json not found at any candidate path:",
        candidates.join(", "),
      );
    }
    console.log("[instrumentation] DATABASE_URL present:", !!process.env.DATABASE_URL);
    console.log("[instrumentation] JWT_SECRET present:", !!process.env.JWT_SECRET);
    console.log("[instrumentation] CLOUDFRONT_URL present:", !!process.env.CLOUDFRONT_URL);
  }
}
