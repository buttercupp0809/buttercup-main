// Shared guard for DB-backed integration tests. Returns true only when the
// configured Postgres is actually reachable, so integration suites run in CI
// and local dev (docker-compose Postgres up) and skip cleanly in environments
// without a database instead of failing the whole run.
//
// Usage:
//   import { dbReachable } from "../test-utils/db";
//   const DB_UP = await dbReachable();
//   describe.skipIf(!DB_UP)("...", () => { ... });
import { prisma } from "@buttercupp/database";

export async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
