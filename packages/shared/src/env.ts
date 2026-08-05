// Runtime env validation. Phase 00 only enforces the two vars every workspace
// needs on boot (DATABASE_URL, JWT_SECRET). Later phases extend the schema
// with LLM keys, storage, queue, payment, and feature flags.

import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().url().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters of entropy"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid env: ${issues}`);
  }
  return result.data;
}
