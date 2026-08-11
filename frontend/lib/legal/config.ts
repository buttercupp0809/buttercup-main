// Single source of truth for legal-page placeholders and the routing table.
// Counsel does one find/replace pass on the {{PLACEHOLDER}} tokens once real
// copy is supplied. Do NOT resolve any of these from process.env; the whole
// point is that the tokens are literal so a `grep -R "{{"` finds every
// unresolved slot before launch.

export const LEGAL = {
  COMPANY: "ButterCupp",
  JURISDICTION: "the United States",
  CONTACT_EMAIL: "admin@buttercupp.fun",
  LAST_UPDATED: "August 9, 2026",
} as const;

export type LegalGroup = "legal" | "company";

export interface LegalPageEntry {
  slug: string;
  title: string;
  group: LegalGroup;
}

// Slugs MUST match the folder names under app/(legal)/legal/* AND the Phase 14
// Footer link table. Do not change one without updating the other; the e2e
// spec crawls the footer and will fail on any drift.
export const LEGAL_PAGES: readonly LegalPageEntry[] = [
  { slug: "terms", title: "Terms of Service", group: "legal" },
  { slug: "privacy", title: "Privacy Policy", group: "legal" },
  { slug: "cookie", title: "Cookie Policy", group: "legal" },
  { slug: "content-policy", title: "Content and Community Policy", group: "legal" },
  { slug: "dmca", title: "DMCA Policy", group: "legal" },
  { slug: "2257", title: "USC 2257 Compliance Statement", group: "legal" },
  { slug: "refund", title: "Refund Policy", group: "legal" },
  { slug: "about", title: "About", group: "company" },
  { slug: "contact", title: "Contact", group: "company" },
];
