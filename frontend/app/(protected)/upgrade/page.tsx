import { requireAuth } from "@/lib/auth";
import { BillingClient } from "../billing/BillingClient";

// Thin entry point so paywallBody.upgradeUrl ("/billing?upgrade=1") and
// direct "/upgrade" CTAs both resolve to a real page. Renders the same
// BillingClient surface as /billing (imported, not duplicated); the optional
// ?plan= query pre-highlights a card. Server component shell + the existing
// client island, matching the /billing page's shape.
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  await requireAuth();
  const { plan } = await searchParams;
  const highlightPlan = plan === "daily" || plan === "weekly" || plan === "monthly" ? plan : undefined;
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <BillingClient highlightPlan={highlightPlan} />
    </section>
  );
}
