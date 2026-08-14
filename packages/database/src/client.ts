// SINGLETON. This is the ONLY file in the repo allowed to construct
// `new PrismaClient()`. Every other consumer imports `prisma` from
// "@buttercupp/database". See CLAUDE.md for the rule.
//
// Shape ported from ../Pellow/packages/database/src/client.ts:
//   - globalThis cache so `next dev` HMR does not leak connections
//   - serverless detection (AWS Lambda / Vercel / EXECUTION_ENV)
//   - pool-param injection on the DATABASE_URL for non-serverless
//     (connection_limit=20, pgbouncer=true, connect_timeout=15, pool_timeout=30)
//   - PrismaPg adapter with a single-connection pg.Pool in serverless
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fs from "fs";
import path from "path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const isServerless = !!(
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.VERCEL ||
  process.env.AWS_EXECUTION_ENV
);

function getDbUrl(): string {
  const url = process.env.DATABASE_URL || "";
  // No DATABASE_URL (e.g. `next build` collecting route data on a host where
  // the runtime env is not injected at build time): return empty so the
  // placeholder in createPrismaClient() is used. Appending params to an empty
  // string yields "?connect_timeout=15", which is NOT a valid URL and throws
  // in `new URL()`, crashing the build. The client stays lazy either way; a
  // real query without a DATABASE_URL still fails at runtime, as intended.
  if (!url) return "";
  if (isServerless) {
    const params: string[] = [];
    if (!url.includes("connect_timeout")) params.push("connect_timeout=15");
    if (params.length === 0) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${params.join("&")}`;
  }
  const params: string[] = [];
  if (!url.includes("connection_limit")) params.push("connection_limit=20");
  if (!url.includes("pgbouncer")) params.push("pgbouncer=true");
  if (!url.includes("connect_timeout")) params.push("connect_timeout=15");
  if (!url.includes("pool_timeout")) params.push("pool_timeout=30");
  if (params.length === 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${params.join("&")}`;
}

// Amplify WEB_COMPUTE ships only `.next/**` plus its own compute output; it
// discards raw node_modules copies and does NOT copy Next's traced native
// Prisma engine (.so.node) into the Lambda. Confirmed via /api/debug on the
// live Lambda: the engine binary was absent everywhere and Prisma searched
// /var/task + /codebuild paths that do not exist at runtime (cwd=/tmp/app).
// The build copies the engine INTO .next/ (the one dir guaranteed to ship);
// here we point Prisma straight at that absolute path so it skips its broken
// search entirely. No-op locally (native darwin engine resolves normally).
function resolveEnginePathForLambda(): void {
  if (!isServerless) return;
  if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) return;
  const engineName = "libquery_engine-rhel-openssl-3.0.x.so.node";
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".next", engineName),
    path.join(cwd, engineName),
    path.join(cwd, "node_modules", ".prisma", "client", engineName),
    path.join(cwd, ".next", "server", engineName),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        process.env.PRISMA_QUERY_ENGINE_LIBRARY = c;
        return;
      }
    } catch {
      /* ignore */
    }
  }
}

function createPrismaClient(): PrismaClient {
  resolveEnginePathForLambda();
  const dbUrl = getDbUrl();

  // queryCompiler requires an adapter ALWAYS (no native engine fallback), so
  // both local and serverless go through PrismaPg. Local Postgres has no TLS,
  // so SSL is only forced for remote hosts.
  const parsed = new URL(dbUrl || "postgresql://placeholder/placeholder");
  parsed.searchParams.delete("sslmode");
  const cleanUrl = parsed.toString();
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const pool = new pg.Pool({
    connectionString: cleanUrl,
    max: isServerless ? 1 : 10,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0]);
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
