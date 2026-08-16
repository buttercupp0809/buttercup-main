// SINGLETON. This is the ONLY file in the repo allowed to construct
// `new PrismaClient()`. Every other consumer imports `prisma` from
// "@buttercupp/database". See CLAUDE.md for the rule.
//
// Shape ported from ../Pellow/packages/database/src/client.ts EXACTLY:
//   - globalThis cache so `next dev` HMR does not leak connections
//   - serverless detection (AWS Lambda / Vercel / EXECUTION_ENV)
//   - pool-param injection on the DATABASE_URL for non-serverless
//     (connection_limit=20, pgbouncer=true, connect_timeout=15, pool_timeout=30)
//   - serverless: PrismaPg adapter over a single-connection pg.Pool
//   - non-serverless: plain PrismaClient on the native engine (no adapter)
//
// NOTE: we deliberately do NOT set PRISMA_QUERY_ENGINE_LIBRARY or force the
// adapter everywhere. Pellow's proven Amplify build ships the native library
// engine (see schema.prisma binaryTargets + the @prisma/engines copy in
// amplify.yml) and Prisma resolves it normally. Mirroring Pellow 1:1 is the
// point of this file.
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

// Safety net for Amplify WEB_COMPUTE. Prisma's native engine ships in the
// `.next/**` artifact, but Prisma searches paths relative to the client bundle
// (e.g. `<cwd>/.next/server`, `.prisma/client`) that do not match where the
// binary lands, producing "could not locate the Query Engine for runtime
// rhel-openssl-3.0.x" (confirmed via /api/debug). amplify.yml now copies the
// engine into every search location; as a belt-and-suspenders we also point
// PRISMA_QUERY_ENGINE_LIBRARY straight at the binary if we can find it. Runs
// lazily (first query), so cwd and the shipped files are stable by then.
function resolveEnginePathForLambda(): void {
  if (!isServerless) return;
  if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) return;
  const engineName = "libquery_engine-rhel-openssl-3.0.x.so.node";
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".next", engineName),
    path.join(cwd, ".next", "server", engineName),
    path.join(cwd, engineName),
    path.join("/var/task", ".next", engineName),
    path.join("/var/task", ".next", "server", engineName),
    path.join(cwd, "node_modules", ".prisma", "client", engineName),
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

function getDbUrl(): string {
  const url = process.env.DATABASE_URL || "";
  // No DATABASE_URL (e.g. `next build` collecting route data on a host where
  // the runtime env is not injected at build time): return empty so callers
  // stay lazy. A real query without a DATABASE_URL still fails at runtime, as
  // intended.
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

function createPrismaClient(): PrismaClient {
  const dbUrl = getDbUrl();

  if (isServerless) {
    const parsed = new URL(dbUrl || "postgresql://placeholder/placeholder");
    parsed.searchParams.delete("sslmode");
    const cleanUrl = parsed.toString();
    const pool = new pg.Pool({
      connectionString: cleanUrl,
      max: 1,
      ssl: { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0]);
  }

  return new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });
}

// LAZY construction. The singleton is built on first property access, not at
// import time. This is the critical fix for Amplify WEB_COMPUTE: env vars are
// injected into process.env by frontend/instrumentation.ts at server startup,
// but the exact ordering of that vs. the first import of this module is not
// guaranteed. Eager construction (`const prisma = createPrismaClient()`) can
// therefore freeze an empty/placeholder DATABASE_URL into the pg.Pool, after
// which every query fails with "Can't reach database server at `placeholder`"
// (confirmed reproduction). Deferring construction to first use guarantees
// DATABASE_URL is present by the time the pool is built.
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    resolveEnginePathForLambda();
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
