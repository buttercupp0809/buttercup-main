import { Suspense } from "react";
import { CharacterWizardProvider } from "./context";
import { WizardShell } from "./WizardShell";

// Wraps every /create route with the wizard provider + the progress rail.
// Providers must be inside a client boundary; the shell is a client
// component that renders header, children slot, and nav buttons.
//
// The Suspense boundary is required because CharacterWizardProvider reads
// useSearchParams() (to detect ?editCharacterId=... for the edit wizard,
// Phase 28); Next.js requires search-param reads to be wrapped so this
// route segment can still participate in static optimization elsewhere.
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <CharacterWizardProvider>
        <WizardShell>{children}</WizardShell>
      </CharacterWizardProvider>
    </Suspense>
  );
}
