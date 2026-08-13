import { requireAuth } from "@/lib/auth";
import { BillingClient } from "./BillingClient";

// Server component: gates on auth. The subscription tiers are presentational
// and entitlements are fetched client-side from the backend.
export default async function BillingPage() {
  await requireAuth();
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <BillingClient />
    </section>
  );
}
