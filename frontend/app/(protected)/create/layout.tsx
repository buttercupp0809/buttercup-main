import { Suspense } from "react";
import { CharacterWizardProvider } from "./context";
import { WizardShell } from "./WizardShell";
import { CreateFlowPaywall } from "@/components/paywall/CreateFlowPaywall";
import { listCharacters } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";

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

// Pull a POOL of live character portraits (S3 / CloudFront) for the paywall
// hero instead of the static bundled /personas/*.webp fallback in PaywallHero.
// We fetch a batch and hand the whole list to the client paywall so it can
// pick a different portrait per wizard step (the layout does not re-run on
// client-side sub-route navigation, so a single server-picked URL would be
// sticky across every step and feel like a static asset). We require an
// https URL so we never accidentally show a seeded local asset (starts
// with "/"). If no remote portrait is available (fresh DB / seed-only
// state), we return an empty list and PaywallHero's own default fires as
// a graceful last resort.
async function loadCreateFlowHeroPool(): Promise<string[]> {
  try {
    const viewer = await getViewer();
    const { items } = await listCharacters(
      { sort: "popular", limit: 24 },
      viewer,
    );
    return items
      .map((c) => c.avatarUrl)
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  } catch {
    return [];
  }
}

export default async function CreateLayout({ children }: { children: React.ReactNode }) {
  const heroImagePool = await loadCreateFlowHeroPool();
  return (
    <Suspense fallback={null}>
      <CreateFlowPaywall
        headline="Create your own version of her"
        heroImagePool={heroImagePool}
      >
        <CharacterWizardProvider>
          <WizardShell>{children}</WizardShell>
        </CharacterWizardProvider>
      </CreateFlowPaywall>
    </Suspense>
  );
}
