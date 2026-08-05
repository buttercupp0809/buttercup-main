// Password hashing. Uses bcryptjs (pure-JS) to avoid native-module rebuilds in
// the Docker image; the cost factor is 12 which is the common floor for 2025+
// hardware. Argon2id is the upgrade path when we can afford a native build in
// the runtime image (Phase 07's worker already needs sharp so we may swap
// there too).
//
// NEVER log a plaintext password. NEVER include one in an audit metadata blob.

import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new TypeError("hashPassword: password must be a non-empty string");
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
