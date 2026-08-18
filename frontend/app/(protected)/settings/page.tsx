import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const user = await requireAuth();
  return (
    <section className="mx-auto max-w-4xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Account"
        title="Your"
        accent="settings"
        description="Manage how ButterCupp knows you, keeps your data safe, and treats your privacy."
      />
      <SettingsClient
        email={user.email}
        jurisdiction={user.jurisdiction ?? null}
        tier={user.subscriptionTier}
        tokenBalance={user.tokenBalance}
        ageVerified={user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null}
      />
    </section>
  );
}
