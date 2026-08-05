import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

// Invoice history = TokenLedger 'purchase'/'grant' rows + Subscription
// state changes. Ledger is the source of truth for billing money-in/out.
export async function GET() {
  const user = await requireAuth();
  const ledger = await prisma.tokenLedger.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    items: ledger.map((l) => ({
      id: l.id,
      delta: l.delta,
      reason: l.reason,
      balanceAfter: l.balanceAfter,
      refId: l.refId,
      createdAt: l.createdAt.toISOString(),
    })),
  });
}
