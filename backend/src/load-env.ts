// Loads the monorepo root .env into process.env. Must be the FIRST import in
// every backend entrypoint (index.ts, worker.ts), before any module that reads
// env at import time (e.g. the Prisma singleton in @poppy/database).
//
// In production (Docker/ECS) the file is absent and env is injected by the
// platform; dotenv simply no-ops when the path does not exist.
import path from "node:path";
import { config } from "dotenv";

// __dirname is backend/src in dev and backend/dist in prod; backend/.env sits
// one level up from either, so ../.env resolves correctly in both cases.
config({ path: path.resolve(__dirname, "../.env") });
