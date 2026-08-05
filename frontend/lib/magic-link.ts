// Magic-link crypto. Store SHA-256(rawToken) at rest, never the raw token.
// Verify with timing-safe compare. Single-use (consumedAt), short TTL
// (MAGIC_LINK_TTL_S). The raw token is the ONLY thing we email; if the DB
// leaks, an attacker cannot recover a usable link.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@buttercupp/database";
import { MAGIC_LINK_TTL_S } from "@/lib/constants";

const TOKEN_BYTES = 32;

export interface IssuedMagicLink {
  rawToken: string;
  expiresAt: Date;
  linkId: string;
}

export async function issueMagicLink(
  userId: string,
  purpose = "login",
): Promise<IssuedMagicLink> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_S * 1000);
  const link = await prisma.magicLink.create({
    data: { userId, tokenHash, purpose, expiresAt },
  });
  return { rawToken, expiresAt, linkId: link.id };
}

export interface ConsumeResult {
  ok: boolean;
  userId?: string;
  reason?: "not_found" | "expired" | "already_used" | "invalid";
}

export async function consumeMagicLink(
  rawToken: string,
  purpose = "login",
): Promise<ConsumeResult> {
  if (typeof rawToken !== "string" || rawToken.length < 8) {
    return { ok: false, reason: "invalid" };
  }
  const inputHash = sha256Hex(rawToken);

  // Load candidate by hash (constant-time DB lookup is not possible; the
  // followup timing-safe compare closes the last mile). The unique index on
  // tokenHash makes this an O(log n) index probe.
  const link = await prisma.magicLink.findUnique({ where: { tokenHash: inputHash } });
  if (!link || link.purpose !== purpose) return { ok: false, reason: "not_found" };

  // Redundant but explicit timing-safe compare of the hashes, in case a
  // future refactor changes the lookup shape (e.g. batched retrieval).
  const a = Buffer.from(inputHash, "hex");
  const b = Buffer.from(link.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" };
  }
  if (link.consumedAt) return { ok: false, reason: "already_used" };
  if (link.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  // Atomic single-use: only succeeds if consumedAt is still null.
  const updated = await prisma.magicLink.updateMany({
    where: { id: link.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (updated.count !== 1) return { ok: false, reason: "already_used" };

  return { ok: true, userId: link.userId };
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
