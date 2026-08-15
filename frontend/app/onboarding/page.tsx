import { redirect } from "next/navigation";

// `/onboarding` is never a dead route: it always sends the visitor to the
// first step.
export default function OnboardingIndex() {
  redirect("/onboarding/identity");
}
