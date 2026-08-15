// Atomic token accounting. Every media job debits at start-of-work; a
// terminal failure refunds. The critical invariant: two concurrent debits
// on the same user must never drive balance negative. We enforce that with
// a conditional updateMany (`tokenBalance: { gte: delta }`) inside a
// transaction; if zero rows matched, throw InsufficientTokensError and
// abort the tx.

import { prisma } from "@buttercupp/database";
import type { TokenReason, Prisma } from "@buttercupp/database";

export class InsufficientTokensError extends Error {
  constructor(
    public readonly required: number,
    public readonly balance: number,
  ) {
    super(`insufficient_tokens: need ${required}, have ${balance}`);
    this.name = "InsufficientTokensError";
  }
}

export interface DebitParams {
  userId: string;
  delta: number; // amount to remove from the balance; 0 is allowed (free jobs)
  reason: TokenReason;
  refId?: string | null;
}

// Phase 28: creation-time character images are free (tokenCost: 0), unlike
// chat selfies which still debit IMAGE_TOKEN_COST. A zero delta is a no-op
// success: no balance change, no TokenLedger row (a ledger row with
// delta: 0 would be noise, not an audit trail entry). Only a NEGATIVE delta
// is rejected as a caller bug; ledgerId is null in the no-op case since no
// row was written.
export async function debitTokens(
  params: DebitParams,
): Promise<{ balanceAfter: number; ledgerId: string | null }> {
  if (params.delta < 0) throw new Error("delta must be non-negative");
  if (params.delta === 0) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { tokenBalance: true },
    });
    if (!user) throw new Error("user_not_found");
    return { balanceAfter: user.tokenBalance, ledgerId: null };
  }
  return prisma.$transaction(async (tx) => {
    // Conditional update. When the balance is short, updateMany returns
    // count 0 and we throw without touching the ledger.
    const result = await tx.user.updateMany({
      where: { id: params.userId, tokenBalance: { gte: params.delta } },
      data: { tokenBalance: { decrement: params.delta } },
    });
    if (result.count !== 1) {
      const current = await tx.user.findUnique({
        where: { id: params.userId },
        select: { tokenBalance: true },
      });
      throw new InsufficientTokensError(params.delta, current?.tokenBalance ?? 0);
    }
    const after = await tx.user.findUnique({
      where: { id: params.userId },
      select: { tokenBalance: true },
    });
    if (!after) throw new Error("user_not_found");
    const ledger = await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        delta: -params.delta,
        reason: params.reason,
        balanceAfter: after.tokenBalance,
        refId: params.refId ?? null,
      } as Prisma.TokenLedgerUncheckedCreateInput,
    });
    return { balanceAfter: after.tokenBalance, ledgerId: ledger.id };
  });
}

// Mirrors debitTokens: a zero-cost job (creation image) has nothing to
// refund on failure, so this is a no-op success rather than a thrown error.
export async function refundTokens(params: DebitParams): Promise<{ balanceAfter: number }> {
  if (params.delta < 0) throw new Error("delta must be non-negative");
  if (params.delta === 0) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { tokenBalance: true },
    });
    if (!user) throw new Error("user_not_found");
    return { balanceAfter: user.tokenBalance };
  }
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: params.userId },
      data: { tokenBalance: { increment: params.delta } },
      select: { tokenBalance: true },
    });
    await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        delta: params.delta,
        reason: params.reason,
        balanceAfter: user.tokenBalance,
        refId: params.refId ?? null,
      } as Prisma.TokenLedgerUncheckedCreateInput,
    });
    return { balanceAfter: user.tokenBalance };
  });
}
