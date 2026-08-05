import { requireAuth } from "@/lib/auth";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const user = await requireAuth();
  return (
    <section className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
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
