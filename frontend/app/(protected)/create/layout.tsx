import { Suspense } from "react";
import { CharacterWizardProvider } from "./context";
import { WizardShell } from "./WizardShell";
import { CreateFlowPaywall } from "@/components/paywall/CreateFlowPaywall";

// Wraps every /create route with the wizard provider + the progress rail.
// Providers must be inside a client boundary; the shell is a client
// component that renders header, children slot, and nav buttons.
//
// The CreateFlowPaywall gate sits above the wizard so free viewers see the
// hero paywall (passes variant) before any wizard state boots. Paid /
// active-pass viewers pass straight through. Backend still enforces the
// underlying create mutation regardless of the client gate.
//
// The Suspense boundary is required because CharacterWizardProvider reads
// useSearchParams() (to detect ?editCharacterId=... for the edit wizard,
// Phase 28); Next.js requires search-param reads to be wrapped so this
// route segment can still participate in static optimization elsewhere.
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <CreateFlowPaywall headline="Create your own version of her">
        <CharacterWizardProvider>
          <WizardShell>{children}</WizardShell>
        </CharacterWizardProvider>
      </CreateFlowPaywall>
    </Suspense>
  );
}
