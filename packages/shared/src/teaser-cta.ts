// Static CTA copy for locked free-tier photo teasers.
//
// Lines are character-flavored, interpolated with {characterName}. Selection
// is deterministic per mediaAssetId (hash mod N) so a given teaser keeps a
// stable line across renders and page reloads. No LLM call, no latency, no
// cost.
//
// Lives in @buttercupp/shared (pure, no I/O) so BOTH the backend delivery
// paths (SSE/WS/worker) and the frontend history SSR (page.tsx) select the
// SAME stable line for a given mediaAssetId.

export const CTA_LINES: ReadonlyArray<string> = [
  "I made this just for you... unlock me",
  "I'm still waiting for you to see it",
  "You're so close. Just one step to see me fully",
  "This one's worth it, I promise. Love, {characterName}",
  "Ready when you are. Will you unlock {characterName}?",
  "I poured my heart into this photo. Don't you want to see {characterName}?",
  "Just for your eyes... when you're ready",
  "Unlock {characterName} and see what she made just for you",
];

// Deterministic selection: hash the mediaAssetId to a stable index so the
// same teaser always shows the same line. Simple and fast with no dependencies.
function hashAssetId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Returns a stable CTA line for the given mediaAssetId, with {characterName}
// interpolated. When no name is provided, a neutral "me" keeps the copy
// natural instead of leaking the raw placeholder.
export function ctaLineFor(mediaAssetId: string, characterName?: string): string {
  const idx = hashAssetId(mediaAssetId) % CTA_LINES.length;
  const line = CTA_LINES[idx] ?? CTA_LINES[0]!;
  return line.replace(
    /\{characterName\}/g,
    characterName && characterName.trim() ? characterName : "me",
  );
}
