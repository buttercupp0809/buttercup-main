import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { OnboardingProvider } from "./context";
import { OnboardingShell } from "./OnboardingShell";

// Onboarding gate, mirroring the (protected) layout's ConsentGate pattern.
// This route group sits OUTSIDE (protected) on purpose: it needs its own
// inverse redirect (bounce an already-onboarded user straight back to
// /dashboard) which would loop if nested under a layout that itself
// redirects un-onboarded users here.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();

  // Must finish age + compliance verification before the wizard runs.
  const ageVerified = user.ageVerifiedAt !== null && user.ageVerificationLevel !== "none";
  if (!ageVerified) redirect("/age-gate");

  // Once-only gate: never re-run for an already-onboarded user.
  if (user.completedOnboardingAt !== null) redirect("/dashboard");

  return (
    <div className="buttercupp-app flex min-h-screen items-center justify-center px-4 py-8">
      <div className="buttercupp-glass w-full max-w-md rounded-2xl p-6 sm:p-8">
        <OnboardingProvider>
          <OnboardingShell>{children}</OnboardingShell>
        </OnboardingProvider>
      </div>
    </div>
  );
}
