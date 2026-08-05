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
  delta: number; // POSITIVE amount to remove from the balance
  reason: TokenReason;
  refId?: string | null;
}

export async function debitTokens(params: DebitParams): Promise<{ balanceAfter: number; ledgerId: string }> {
  if (params.delta <= 0) throw new Error("delta must be positive");
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

export async function refundTokens(params: DebitParams): Promise<{ balanceAfter: number }> {
  if (params.delta <= 0) throw new Error("delta must be positive");
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
