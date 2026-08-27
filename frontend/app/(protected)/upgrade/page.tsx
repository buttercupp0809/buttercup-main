import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { PaywallHero } from "@/components/paywall/PaywallHero";
import type { BillingInterval } from "../billing/BillingClient";

// Hero paywall entry point. Renders the Figma "iPhone 17 - 2" pricing surface
// (PaywallHero) as the primary conversion moment. One-time-pass CTAs still
// exist elsewhere in the product; when a caller deep-links to /upgrade with a
// non-subscription plan we forward straight to /billing?plan=... so the
// existing detailed catalog handles the highlight, keeping this route
// subscription-focused (which is what the hero design supports).
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  await requireAuth();
  const { plan } = await searchParams;

  if (plan === "daily" || plan === "weekly" || plan === "monthly") {
    redirect(`/billing?plan=${plan}`);
  }

  const initialInterval: BillingInterval = plan === "sub_monthly" ? "month" : "year";

  return <PaywallHero initialInterval={initialInterval} />;
}
