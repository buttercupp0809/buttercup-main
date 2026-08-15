// Integration tests for the atomic token ledger. Requires a live local DB
// with the buttercupp schema (buttercupp_dev). Uses randomized email addresses so the
// tests are safe to re-run without cleanup.

import { describe, expect, it } from "vitest";
import { prisma } from "@buttercupp/database";
import { debitTokens, refundTokens, InsufficientTokensError } from "./token-ledger";
import { dbReachable } from "../test-utils/db";

const DB_UP = await dbReachable();

async function makeUser(startBalance: number): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `token-${crypto.randomUUID()}@test.local`,
      tokenBalance: startBalance,
    },
  });
  return u.id;
}

describe.skipIf(!DB_UP)("token ledger", () => {
  it("debits atomically and writes a matching ledger row", async () => {
    const userId = await makeUser(50);
    const { balanceAfter } = await debitTokens({
      userId,
      delta: 20,
      reason: "image_gen",
      refId: "test",
    });
    expect(balanceAfter).toBe(30);
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(-20);
    expect(ledger[0].balanceAfter).toBe(30);
  });

  it("refuses when balance is short and leaves the balance untouched", async () => {
    const userId = await makeUser(5);
    await expect(
      debitTokens({ userId, delta: 20, reason: "image_gen" }),
    ).rejects.toBeInstanceOf(InsufficientTokensError);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { tokenBalance: true } });
    expect(u?.tokenBalance).toBe(5);
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(0);
  });

  it("refunds add a positive ledger entry", async () => {
    const userId = await makeUser(0);
    const { balanceAfter } = await refundTokens({
      userId,
      delta: 10,
      reason: "image_gen",
    });
    expect(balanceAfter).toBe(10);
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(10);
  });

  // Phase 28: creation-time character images are free (tokenCost: 0).
  it("a zero-cost debit is a no-op: no ledger row, balance untouched", async () => {
    const userId = await makeUser(15);
    const { balanceAfter, ledgerId } = await debitTokens({ userId, delta: 0, reason: "image_gen" });
    expect(balanceAfter).toBe(15);
    expect(ledgerId).toBeNull();
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(0);
  });

  it("a zero-cost refund is a no-op: no ledger row, balance untouched", async () => {
    const userId = await makeUser(15);
    const { balanceAfter } = await refundTokens({ userId, delta: 0, reason: "image_gen" });
    expect(balanceAfter).toBe(15);
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(0);
  });

  it("a chat selfie at IMAGE_TOKEN_COST still debits and writes a ledger row", async () => {
    const IMAGE_TOKEN_COST = 20;
    const userId = await makeUser(50);
    const { balanceAfter, ledgerId } = await debitTokens({
      userId,
      delta: IMAGE_TOKEN_COST,
      reason: "image_gen",
    });
    expect(balanceAfter).toBe(30);
    expect(ledgerId).not.toBeNull();
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(1);
  });

  it("concurrent debits never drive the balance negative", async () => {
    const userId = await makeUser(30);
    const results = await Promise.allSettled([
      debitTokens({ userId, delta: 20, reason: "image_gen" }),
      debitTokens({ userId, delta: 20, reason: "image_gen" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const bad = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InsufficientTokensError,
    ).length;
    expect(ok).toBe(1);
    expect(bad).toBe(1);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { tokenBalance: true } });
    expect(u?.tokenBalance).toBe(10);
  });
});
