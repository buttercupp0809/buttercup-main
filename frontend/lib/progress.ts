// Read-only progression derivation. Follows the lib/relationship.ts contract:
// every function swallows its errors and returns a safe empty shape, so a
// cold database or a brand-new user renders cleanly instead of 500ing a page.
//
// IMPORTANT: this module only ever READS. There is no schema for streaks, XP,
// quests or badges, and adding one is a backend change. Everything here is
// derived on the fly from rows the product already writes during normal use:
//
//   streak        distinct local days with a user-authored Message
//   bond score    Conversation.messageCount + Memory rows + active days
//   quests        today's slice of the same three sources
//
// The upside of deriving rather than storing is that progress can never
// desync from reality: the bond is a view over the conversation, not a
// separate number that has to be kept in step with it. The cost is that these
// are aggregate reads, so every query here is bounded (see STREAK_WINDOW_DAYS)
// and selects the narrowest possible column set.

import { prisma } from "@buttercupp/database";
import {
  bondProgress,
  computeStreak,
  toDayKey,
  type BondProgress,
  type StreakResult,
} from "@/lib/bond";

// A year of history is far more than any streak UI shows, and caps the row
// count on a heavy user at a few thousand narrow rows.
const STREAK_WINDOW_DAYS = 365;

export interface DailyQuest {
  id: string;
  label: string;
  /** Short "why this is worth doing" line. */
  hint: string;
  done: boolean;
  /** Progress toward the goal, for partial-credit rendering. */
  progress: number;
  goal: number;
}

export interface UserProgress {
  streak: StreakResult;
  quests: DailyQuest[];
  questsDone: number;
  /** Lifetime totals, used for the profile/dashboard stat row. */
  totals: { messages: number; memories: number; companions: number };
  /** Bond across ALL companions, so the dashboard can show one headline tier. */
  overall: BondProgress;
}

const EMPTY_PROGRESS: UserProgress = {
  streak: { current: 0, best: 0, activeToday: false, usedGrace: false, atRisk: false },
  quests: [],
  questsDone: 0,
  totals: { messages: 0, memories: 0, companions: 0 },
  overall: bondProgress({ messageCount: 0, memoryCount: 0, activeDays: 0 }),
};

export async function getUserProgress(userId: string): Promise<UserProgress> {
  try {
    const now = new Date();
    const todayKey = toDayKey(now);
    const windowStart = new Date(now.getTime() - STREAK_WINDOW_DAYS * 86_400_000);
    const startOfToday = new Date(`${todayKey}T00:00:00.000Z`);

    const [userMessages, memoryDates, conversations, reelLikesToday] = await Promise.all([
      // Only user-authored messages count toward a streak: her replies are not
      // evidence that the user showed up.
      prisma.message.findMany({
        where: { role: "user", createdAt: { gte: windowStart }, conversation: { userId } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.memory.findMany({
        where: { userId },
        select: { createdAt: true },
      }),
      prisma.conversation.findMany({
        where: { userId },
        select: { messageCount: true },
      }),
      prisma.reelLike.count({ where: { userId, createdAt: { gte: startOfToday } } }),
    ]);

    const dayKeys = userMessages.map((m) => toDayKey(m.createdAt));
    const streak = computeStreak(dayKeys, todayKey);

    const messagesToday = dayKeys.reduce((n, k) => (k === todayKey ? n + 1 : n), 0);
    const memoriesToday = memoryDates.reduce(
      (n, m) => (toDayKey(m.createdAt) === todayKey ? n + 1 : n),
      0,
    );

    const totals = {
      messages: conversations.reduce((n, c) => n + c.messageCount, 0),
      memories: memoryDates.length,
      companions: conversations.length,
    };

    const quests = buildQuests({ messagesToday, memoriesToday, reelLikesToday });

    return {
      streak,
      quests,
      questsDone: quests.filter((q) => q.done).length,
      totals,
      overall: bondProgress({
        messageCount: totals.messages,
        memoryCount: totals.memories,
        activeDays: new Set(dayKeys).size,
      }),
    };
  } catch {
    return EMPTY_PROGRESS;
  }
}

function buildQuests(input: {
  messagesToday: number;
  memoriesToday: number;
  reelLikesToday: number;
}): DailyQuest[] {
  // Three quests, not eight. A short list gets finished; a long one gets
  // ignored and turns the HUD into wallpaper. Each one maps to a real
  // behaviour we want (show up, go deep, explore) rather than to a vanity
  // counter, and each is satisfiable in the normal course of using the app.
  const say = Math.min(input.messagesToday, 1);
  const deep = Math.min(input.messagesToday, 10);
  const explore = Math.min(input.reelLikesToday + input.memoriesToday, 1);
  return [
    {
      id: "say-hi",
      label: "Say hello",
      hint: "One message keeps your streak alive.",
      done: say >= 1,
      progress: say,
      goal: 1,
    },
    {
      id: "go-deeper",
      label: "Have a real conversation",
      hint: "Ten messages back and forth.",
      done: deep >= 10,
      progress: deep,
      goal: 10,
    },
    {
      id: "explore",
      label: "Discover something",
      hint: "Watch a reel or let her learn something new about you.",
      done: explore >= 1,
      progress: explore,
      goal: 1,
    },
  ];
}

// ---------------------------------------------------------------------------
// Per-companion bond
// ---------------------------------------------------------------------------

export interface CompanionBond extends BondProgress {
  /** Memories she holds about you, shown as the receipt for the tier. */
  memoryCount: number;
  messageCount: number;
  /** Distinct days you two have talked. */
  activeDays: number;
  /** Most recent things she remembered, newest first. Proof, not decoration. */
  recentMemories: string[];
}

/**
 * Batched bond lookup for a list of companions (dashboard rail, /chats rows).
 *
 * Deliberately 3 queries total rather than calling getCompanionBond per
 * character, which would fan out to 4 queries each and turn a six-avatar rail
 * into two dozen round trips. Characters with no conversation yet simply come
 * back at the base tier.
 */
export async function getBondsForCharacters(
  userId: string,
  characterIds: readonly string[],
): Promise<Map<string, BondProgress>> {
  const out = new Map<string, BondProgress>();
  if (characterIds.length === 0) return out;
  try {
    const [conversations, memoryGroups] = await Promise.all([
      prisma.conversation.findMany({
        where: { userId, characterId: { in: [...characterIds] } },
        select: { id: true, characterId: true, messageCount: true },
      }),
      prisma.memory.groupBy({
        by: ["characterId"],
        where: { userId, characterId: { in: [...characterIds] } },
        _count: { _all: true },
      }),
    ]);

    const charByConversation = new Map(conversations.map((c) => [c.id, c.characterId]));
    const messages =
      conversations.length === 0
        ? []
        : await prisma.message.findMany({
            where: { role: "user", conversationId: { in: conversations.map((c) => c.id) } },
            select: { conversationId: true, createdAt: true },
          });

    const daysByChar = new Map<string, Set<string>>();
    for (const m of messages) {
      const charId = charByConversation.get(m.conversationId);
      if (!charId) continue;
      const set = daysByChar.get(charId) ?? new Set<string>();
      set.add(toDayKey(m.createdAt));
      daysByChar.set(charId, set);
    }

    const memoryByChar = new Map(memoryGroups.map((g) => [g.characterId, g._count._all]));
    const countByChar = new Map(conversations.map((c) => [c.characterId, c.messageCount]));

    for (const id of characterIds) {
      out.set(
        id,
        bondProgress({
          messageCount: countByChar.get(id) ?? 0,
          memoryCount: memoryByChar.get(id) ?? 0,
          activeDays: daysByChar.get(id)?.size ?? 0,
        }),
      );
    }
    return out;
  } catch {
    return out;
  }
}

export async function getCompanionBond(
  userId: string,
  characterId: string,
): Promise<CompanionBond> {
  const empty: CompanionBond = {
    ...bondProgress({ messageCount: 0, memoryCount: 0, activeDays: 0 }),
    memoryCount: 0,
    messageCount: 0,
    activeDays: 0,
    recentMemories: [],
  };
  try {
    const [conversation, memories, messageDays] = await Promise.all([
      prisma.conversation.findUnique({
        where: { userId_characterId: { userId, characterId } },
        select: { messageCount: true },
      }),
      prisma.memory.findMany({
        where: { userId, characterId },
        select: { content: true, createdAt: true },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 60,
      }),
      prisma.message.findMany({
        where: { role: "user", conversation: { userId, characterId } },
        select: { createdAt: true },
      }),
    ]);

    const memoryCount = await prisma.memory.count({ where: { userId, characterId } });
    const messageCount = conversation?.messageCount ?? 0;
    const activeDays = new Set(messageDays.map((m) => toDayKey(m.createdAt))).size;

    return {
      ...bondProgress({ messageCount, memoryCount, activeDays }),
      memoryCount,
      messageCount,
      activeDays,
      recentMemories: memories.slice(0, 5).map((m) => m.content),
    };
  } catch {
    return empty;
  }
}
