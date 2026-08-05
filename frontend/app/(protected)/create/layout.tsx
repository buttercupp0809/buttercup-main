import { CharacterWizardProvider } from "./context";
import { WizardShell } from "./WizardShell";

// Wraps every /create route with the wizard provider + the progress rail.
// Providers must be inside a client boundary; the shell is a client
// component that renders header, children slot, and nav buttons.
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <CharacterWizardProvider>
      <WizardShell>{children}</WizardShell>
    </CharacterWizardProvider>
  );
}
