// Phase 34 Feature C: email verification tokens. Reuses the MagicLink table
// with purpose="email-verify" (see packages/database/prisma/schema.prisma).
// The raw token is emailed once; only its SHA-256 hash is stored so a DB leak
// cannot recover a usable link. TTL is 24h (longer than login magic links
// because a signup email may sit in an inbox for a while). Invalidating prior
// unconsumed tokens keeps only one live link per user, so a resent link
// supersedes the previous one.

import { prisma } from "@buttercupp/database";
import { randomBytes } from "crypto";
import { sha256Hex } from "@/lib/magic-link";

export const EMAIL_VERIFY_PURPOSE = "email-verify";
export const EMAIL_VERIFY_TTL_S = 60 * 60 * 24;
const TOKEN_BYTES = 32;

export interface IssuedEmailVerification {
  rawToken: string;
  expiresAt: Date;
  linkId: string;
}

// Issue a new verification token for `userId`. Invalidates any prior
// unconsumed email-verify tokens for the user by stamping consumedAt=now(),
// so only the freshest link is ever accepted. `email` is accepted so callers
// can log or bind it, but the address of record is always the User row.
export async function issueEmailVerification(
  userId: string,
  _email: string,
): Promise<IssuedEmailVerification> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_S * 1000);

  await prisma.magicLink.updateMany({
    where: { userId, purpose: EMAIL_VERIFY_PURPOSE, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const link = await prisma.magicLink.create({
    data: { userId, tokenHash, purpose: EMAIL_VERIFY_PURPOSE, expiresAt },
  });
  return { rawToken, expiresAt, linkId: link.id };
}

export interface ConsumeVerificationResult {
  ok: boolean;
  userId?: string;
  reason?: "invalid" | "not_found" | "expired" | "already_used";
}

// Validate a raw token, mark it consumed, and stamp User.emailVerifiedAt.
// Atomic single-use is enforced by the updateMany({consumedAt: null}) guard,
// so two concurrent requests with the same token cannot both succeed.
export async function consumeEmailVerification(
  rawToken: string,
): Promise<ConsumeVerificationResult> {
  if (typeof rawToken !== "string" || rawToken.length < 8) {
    return { ok: false, reason: "invalid" };
  }
  const tokenHash = sha256Hex(rawToken);
  const link = await prisma.magicLink.findUnique({ where: { tokenHash } });
  if (!link || link.purpose !== EMAIL_VERIFY_PURPOSE) {
    return { ok: false, reason: "not_found" };
  }
  if (link.consumedAt) return { ok: false, reason: "already_used" };
  if (link.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const updated = await prisma.magicLink.updateMany({
    where: { id: link.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (updated.count !== 1) return { ok: false, reason: "already_used" };

  await prisma.user.update({
    where: { id: link.userId },
    data: { emailVerifiedAt: new Date() },
  });

  return { ok: true, userId: link.userId };
}
