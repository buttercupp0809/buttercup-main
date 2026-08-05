import { requireAuth } from "@/lib/auth";
import { prisma } from "@buttercupp/database";
import { BillingClient } from "./BillingClient";

// Server component: fetches the ledger + current token balance. Plan
// catalog and entitlements are fetched by the client from the backend
// (GET /billing/plans, GET /billing/entitlements) so quota numbers can
// live in exactly one place (backend/src/subscription/plans.ts).
export default async function BillingPage() {
  const user = await requireAuth();
  const ledger = await prisma.tokenLedger.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <BillingClient
        tokenBalance={user.tokenBalance}
        ledger={ledger.map((l) => ({
          id: l.id,
          delta: l.delta,
          reason: l.reason,
          balanceAfter: l.balanceAfter,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </section>
  );
}
