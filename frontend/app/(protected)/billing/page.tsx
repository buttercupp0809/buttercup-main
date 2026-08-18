import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { BillingClient } from "./BillingClient";

// Server component: gates on auth. Plan cards + the current-plan panel are
// fetched client-side from the backend (GET /billing/plans, GET
// /billing/entitlements); nothing here hardcodes quota or price numbers.
// `?plan=` pre-highlights a card (same query paywallBody.upgradeUrl and
// PaywallModal "See all plans" links can pass through).
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  await requireAuth();
  const { plan } = await searchParams;
  const highlightPlan =
    plan === "daily" ||
      plan === "weekly" ||
      plan === "monthly" ||
      plan === "sub_monthly" ||
      plan === "sub_yearly"
      ? plan
      : undefined;
  return (
    <section className="mx-auto max-w-5xl px-6 py-6 sm:py-8">
      <BillingClient highlightPlan={highlightPlan} />
    </section>
  );
}
