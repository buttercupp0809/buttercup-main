// Single source of truth for every trust and privacy message shown across
// the product. Every consumer (marketing block, auth strip, onboarding
// callout, chat header chip, settings section, legal deep page) imports
// from here so we never fork copy or drift on a promise we later cannot
// keep. If you need to change a claim, change it here.
//
// Honesty rule (agreed with product): describe what is actually true.
// TLS in transit, AWS KMS at rest, per-account scoping via ownerUserId,
// 18+ age gate, one-tap delete, no data sale, no third-party training on
// private chats. Do NOT introduce copy that claims E2EE, zero-knowledge,
// or "bank-level" security. Those are either false today or regulator red
// flags.

export interface TrustPromise {
  id: string;
  title: string;
  body: string;
  emoji: string;
}

export const TRUST_PROMISES: readonly TrustPromise[] = [
  {
    id: "locked",
    emoji: "\uD83D\uDD12",
    title: "Locked and sealed",
    body: "Everything you send is scrambled on the way in and locked in a vault at rest. Even we cannot casually peek at your chats.",
  },
  {
    id: "yours-alone",
    emoji: "\uD83D\uDC64",
    title: "Yours alone",
    body: "Every companion belongs to you. Nobody else sees them. Not on search engines, not in our marketing, not anywhere.",
  },
  {
    id: "no-training",
    emoji: "\uD83D\uDEAB",
    title: "Never trained on",
    body: "Your private chats are not sold, not shared, and not used to train anyone else's AI. Full stop.",
  },
  {
    id: "erasable",
    emoji: "\uD83D\uDDD1\uFE0F",
    title: "Yours to erase",
    body: "One tap deletes a companion. One tap wipes your account. Gone means gone, no shadow copies.",
  },
] as const;

export interface TrustChip {
  id: string;
  label: string;
}

// Compact chips used on auth pages and inside the onboarding callout. They
// are meant to reassure at a glance, not to explain. The deep page carries
// the explanation.
export const TRUST_CHIPS: readonly TrustChip[] = [
  { id: "locked", label: "Locked and private" },
  { id: "yours-alone", label: "Yours alone" },
  { id: "age", label: "18+ only" },
  { id: "delete", label: "Delete anytime" },
] as const;

// Marketing headline + subhead reused by the big block and by the legal
// deep page hero so the two never drift.
export const TRUST_HEADLINE = "What you share stays yours.";
export const TRUST_SUBHEAD =
  "ButterCupp is a private space by design. Here is what that actually means, in plain English.";
