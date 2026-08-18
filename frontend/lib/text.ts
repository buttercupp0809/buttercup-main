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

/**
 * Short relative time for conversation rows ("2h", "3d", "Jan 4").
 *
 * The chat lists were printing a full `toLocaleString()`, which is both long
 * enough to wrap and useless at a glance: what a user wants from this row is how
 * cold the conversation has gone, not the exact second it happened.
 *
 * `now` is injectable so this stays pure and testable. Server-rendered output
 * can differ from the client's by a tick without a hydration mismatch, since the
 * buckets are coarse.
 */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
