// Pure text helpers, safe for both server and client components. Nothing
// here may import server-only APIs (`next/headers`, Prisma, auth) so
// client bundles can pull these in without dragging in the server chain.

// Derive a short tagline from a longer bio. Trims on a word boundary at
// ~max chars so overlays never wrap awkwardly. Safe for empty input.
export function taglineFrom(bio: string, max = 80): string {
  const clean = (bio ?? "").trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
  return `${cut}...`;
}
