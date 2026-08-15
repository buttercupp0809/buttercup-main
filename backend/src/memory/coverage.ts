// Phase 30: gap-free memory summary injection, ported from the sibling
// Pellow project and simplified. Poppy's MemorySummary has no `period`
// column (only periodStart/periodEnd), so this fetches the newest N
// summaries for a (userId, characterId) pair, oldest to newest, under a
// character budget instead of Pellow's monthly/weekly/daily tier fetch.
// Pure fetch, no LLM in the read path. Behind memoryTieredContextEnabled();
// flag-off returns the single latest summary, byte-identical to today's
// getLatestSummary (llm/memory-retriever.ts).

import { prisma } from "@buttercupp/database";
import type { MemorySummary } from "@buttercupp/database";
import { assertSafeId } from "../utils/safe-types";
import { memoryTieredContextEnabled } from "../config/flags";

export interface TieredSummary {
  summary: string;
  periodStart: Date;
  periodEnd: Date;
}

const SUMMARY_FETCH_CAP = 20;
// Approximate token cap for the combined summary layer (chars / 4).
const TOKEN_BUDGET = 1200;
const CHAR_BUDGET = TOKEN_BUDGET * 4;

export async function getTieredSummaries(
  userId: string,
  characterId: string,
): Promise<{ summaries: TieredSummary[]; truncated: boolean }> {
  const safeUserId = assertSafeId(userId, "userId");
  const safeCharacterId = assertSafeId(characterId, "characterId");

  if (!memoryTieredContextEnabled()) {
    // Legacy path: single latest summary, byte-identical to getLatestSummary.
    const latest = await prisma.memorySummary.findFirst({
      where: { userId: safeUserId, characterId: safeCharacterId },
      orderBy: { periodEnd: "desc" },
      select: { summary: true, periodStart: true, periodEnd: true },
    });
    return { summaries: latest ? [latest] : [], truncated: false };
  }

  const rowsDesc = await prisma.memorySummary.findMany({
    where: { userId: safeUserId, characterId: safeCharacterId },
    orderBy: { periodEnd: "desc" },
    take: SUMMARY_FETCH_CAP,
    select: { summary: true, periodStart: true, periodEnd: true },
  });

  const stack = [...rowsDesc].sort((a, b) => a.periodEnd.getTime() - b.periodEnd.getTime());

  // Token budget: drop OLDEST first when over. Never drop the newest.
  let truncated = false;
  const size = () => stack.reduce((s, x) => s + x.summary.length, 0);
  while (stack.length > 1 && size() > CHAR_BUDGET) {
    stack.shift();
    truncated = true;
  }

  return { summaries: stack, truncated };
}

function safeFormat(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
  }
}

// Heuristic label from the summary's own span (poppy has no period column):
// >= 25 days -> "Month of X", >= 6 days -> "Week of X-Y", else -> "Day of X".
export function formatTieredSummaries(summaries: TieredSummary[], timezone: string): string[] {
  const tz = timezone || "UTC";
  const dayFmt = safeFormat(tz, { month: "short", day: "numeric" });
  const monthFmt = safeFormat(tz, { month: "short" });
  return summaries.map((s) => {
    const spanDays = Math.max(0, (s.periodEnd.getTime() - s.periodStart.getTime()) / (24 * 60 * 60 * 1000));
    if (spanDays >= 25) {
      return `[Month of ${monthFmt.format(s.periodEnd)}] ${s.summary}`;
    }
    if (spanDays >= 6) {
      return `[Week of ${dayFmt.format(s.periodStart)}-${dayFmt.format(s.periodEnd)}] ${s.summary}`;
    }
    return `[Day of ${dayFmt.format(s.periodEnd)}] ${s.summary}`;
  });
}

// Test-only helper type export so tests can construct fixtures without
// importing the Prisma model directly.
export type { MemorySummary };
