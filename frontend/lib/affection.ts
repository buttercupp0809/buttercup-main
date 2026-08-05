// Pure affection helpers. No server-only imports (no Prisma, no
// `next/headers`) so client components can pull these in without dragging
// the DB client into their bundle. The [0, 100] scale is shared by the
// chat header and the character-detail page.

export function clampAffection(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

export function affectionPercent(n: number): number {
  return clampAffection(n);
}
