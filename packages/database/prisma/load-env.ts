// Loads backend/.env (the home of DATABASE_URL) into process.env. Must be the
// FIRST import in any standalone script under prisma/ that is run directly via
// `tsx` (not through the Prisma CLI, which loads env itself via
// prisma.config.ts), before any module that reads env at import time (e.g. the
// Prisma singleton in @buttercupp/database).
import path from "node:path";
import { config } from "dotenv";

config({ path: path.join(__dirname, "..", "..", "..", "backend", ".env") });
