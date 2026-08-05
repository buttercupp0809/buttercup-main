// Loads backend/.env into process.env before any test module is imported, so
// the Prisma singleton (which reads DATABASE_URL at construction) and any code
// that reads env sees the same server secrets as the backend. Runs once per
// worker via setupFiles in vitest.config.ts.
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "backend", ".env") });
