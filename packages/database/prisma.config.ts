// Prisma config (replaces the deprecated package.json#prisma block, removed in
// Prisma 7). When a config file is present Prisma no longer auto-loads .env, so
// we load DATABASE_URL from backend/.env (the home of all server + DB secrets),
// anchored to this file's directory so it works from any cwd.
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: path.join(__dirname, "..", "..", "backend", ".env") });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
