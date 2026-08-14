import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cwd = process.cwd();

  // Check all candidate paths for server-env.json
  const candidates = [
    path.join(cwd, ".next", "server-env.json"),
    path.join(cwd, "server-env.json"),
    path.join(cwd, "..", ".next", "server-env.json"),
  ];

  const candidateStatus = candidates.map((p) => ({
    path: p,
    exists: fs.existsSync(p),
  }));

  // List top-level files in cwd
  let cwdFiles: string[] = [];
  try { cwdFiles = fs.readdirSync(cwd); } catch { /* ignore */ }

  // Try a raw pg connection (bypasses Prisma to isolate DB vs env issues)
  let dbPing: string;
  try {
    const { Pool } = await import("pg");
    const dbUrl = process.env.DATABASE_URL ?? "";
    if (!dbUrl) {
      dbPing = "NO_DATABASE_URL";
    } else {
      const pool = new Pool({ connectionString: dbUrl, max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      const client = await pool.connect();
      const res = await client.query("SELECT COUNT(*) AS users FROM \"User\"");
      client.release();
      await pool.end();
      dbPing = `OK - users=${res.rows[0].users}`;
    }
  } catch (e) {
    dbPing = `ERROR: ${String(e).slice(0, 300)}`;
  }

  return NextResponse.json({
    cwd,
    cwdFiles,
    candidateStatus,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? "SET" : "MISSING",
      JWT_SECRET: process.env.JWT_SECRET ? "SET" : "MISSING",
      NODE_ENV: process.env.NODE_ENV,
      NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME ?? "(not set)",
      AWS_EXECUTION_ENV: process.env.AWS_EXECUTION_ENV ?? "(not set)",
    },
    dbPing,
  });
}
