// Tier rebalancer. Runs on a schedule (or on threshold) per (user, character)
// and reassigns hot/warm/cold based on Pellow's precedence rules mapped to
// ButterCupp's three-tier scheme:
//   sacred  -> hot (pinned OR importance>=0.9 on identity/relationship)
//   cold    -> stale AND low importance, OR expired validUntil
//   hot     -> frequently accessed recent memories, capped at CORE_CAP
//   warm    -> everything else
//
// Access counts and lastAccessedAt are maintained by the retriever
// (markMemoriesAccessed).

import { prisma } from "@buttercupp/database";
import type { Memory, MemoryTier } from "@buttercupp/database";

export const CORE_CAP = 25;
export const COLD_MIN_AGE_DAYS = 90;
export const COLD_MAX_IMPORTANCE = 0.5;
export const HOT_ACCESS_THRESHOLD = 5;
export const HOT_ACCESS_WINDOW_DAYS = 30;

const SACRED_TOPICS = new Set(["identity", "relationship"]);

const DAY_MS = 24 * 60 * 60 * 1000;

interface TierResult {
  moved: { id: string; from: MemoryTier; to: MemoryTier }[];
  hotCount: number;
  warmCount: number;
  coldCount: number;
}

export function classifyTier(memory: Memory, now: Date): MemoryTier {
  // 1. Sacred: pinned OR very high importance on identity/relationship topic.
  if (memory.pinned) return "hot";
  if (memory.importance >= 0.9 && SACRED_TOPICS.has(memory.category)) return "hot";

  // 2. Cold: expired validUntil, or old + unaccessed + low importance.
  if (memory.validUntil && memory.validUntil.getTime() < now.getTime()) return "cold";
  const ageDays = (now.getTime() - memory.createdAt.getTime()) / DAY_MS;
  const lastAccessDays = memory.lastAccessedAt
    ? (now.getTime() - memory.lastAccessedAt.getTime()) / DAY_MS
    : ageDays;
  if (lastAccessDays >= COLD_MIN_AGE_DAYS && memory.importance <= COLD_MAX_IMPORTANCE) {
    return "cold";
  }

  // 3. Hot: frequently accessed within the recent window.
  if (
    memory.accessCount >= HOT_ACCESS_THRESHOLD &&
    lastAccessDays <= HOT_ACCESS_WINDOW_DAYS
  ) {
    return "hot";
  }

  return "warm";
}

export async function rebalanceTiers(
  userId: string,
  characterId: string,
): Promise<TierResult> {
  const memories = await prisma.memory.findMany({
    where: { userId, characterId },
  });

  const now = new Date();
  const desired: { m: Memory; tier: MemoryTier }[] = memories.map((m) => ({
    m,
    tier: classifyTier(m, now),
  }));

  // Enforce CORE_CAP on hot: keep the top CORE_CAP by (importance,
  // accessCount, recency) and demote the rest to warm.
  const hotDesired = desired.filter((d) => d.tier === "hot");
  if (hotDesired.length > CORE_CAP) {
    hotDesired.sort((a, b) => {
      if (b.m.importance !== a.m.importance) return b.m.importance - a.m.importance;
      if (b.m.accessCount !== a.m.accessCount) return b.m.accessCount - a.m.accessCount;
      return b.m.createdAt.getTime() - a.m.createdAt.getTime();
    });
    for (let i = CORE_CAP; i < hotDesired.length; i++) {
      hotDesired[i].tier = "warm";
    }
  }

  const moved: TierResult["moved"] = [];
  for (const d of desired) {
    if (d.m.tier !== d.tier) {
      moved.push({ id: d.m.id, from: d.m.tier, to: d.tier });
    }
  }

  // Write back in one transaction: a rebalance is all-or-nothing so a
  // partial commit cannot strand memories in an inconsistent hot/warm/cold
  // split. Uses the array form of $transaction (a set of independent
  // updateMany calls; no interactive read is needed inside the tx).
  // Phase 23 hardening; classification logic itself is unchanged.
  const groups: Record<MemoryTier, string[]> = { hot: [], warm: [], cold: [] };
  for (const d of desired) groups[d.tier].push(d.m.id);
  const ops = (Object.entries(groups) as [MemoryTier, string[]][])
    .filter(([, ids]) => ids.length > 0)
    .map(([tier, ids]) =>
      prisma.memory.updateMany({ where: { id: { in: ids } }, data: { tier } }),
    );
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }

  return {
    moved,
    hotCount: groups.hot.length,
    warmCount: groups.warm.length,
    coldCount: groups.cold.length,
  };
}

export async function getTierStats(userId: string, characterId: string) {
  const rows = await prisma.memory.groupBy({
    by: ["tier"],
    where: { userId, characterId },
    _count: { _all: true },
  });
  const out: Record<MemoryTier, number> = { hot: 0, warm: 0, cold: 0 };
  for (const r of rows) out[r.tier] = r._count._all;
  return out;
}
