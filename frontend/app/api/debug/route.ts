import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cwd = process.cwd();
  const serverEnvPath = path.join(cwd, ".next", "server-env.json");

  let serverEnvExists = false;
  let serverEnvKeys: string[] = [];
  try {
    const raw = fs.readFileSync(serverEnvPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string | null>;
    serverEnvExists = true;
    serverEnvKeys = Object.entries(parsed)
      .filter(([, v]) => v !== null && v !== "")
      .map(([k]) => k);
  } catch {
    // ignore
  }

  // Try a DB ping without importing prisma (avoids module-load-time issue)
  let dbPing: string;
  try {
    const { Pool } = await import("pg");
    const dbUrl = process.env.DATABASE_URL ?? "";
    if (!dbUrl) {
      dbPing = "NO_DATABASE_URL";
    } else {
      const pool = new Pool({ connectionString: dbUrl, max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      const client = await pool.connect();
      const res = await client.query("SELECT 1 AS ping");
      client.release();
      await pool.end();
      dbPing = res.rows[0].ping === 1 ? "OK" : "BAD_ROW";
    }
  } catch (e) {
    dbPing = `ERROR: ${String(e).slice(0, 200)}`;
  }

  return NextResponse.json({
    cwd,
    serverEnvPath,
    serverEnvExists,
    serverEnvKeys,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? "SET" : "MISSING",
      JWT_SECRET: process.env.JWT_SECRET ? "SET" : "MISSING",
      NODE_ENV: process.env.NODE_ENV,
      NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME ?? "(not set)",
    },
    dbPing,
  });
}
