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

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
