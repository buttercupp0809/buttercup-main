// Pure bond/progression helpers. No server-only imports (no Prisma, no
// `next/headers`) so client components can pull these in without dragging the
// DB client into their bundle. Mirrors the lib/affection.ts + lib/relationship.ts
// split: derivation that needs the DB lives in lib/progress.ts.
//
// WHY THESE NUMBERS
//
// The bond score is deliberately weighted so that *consistency* and *being
// known* outrank raw volume. Spamming 500 messages in one sitting moves the
// bond less than talking for ten days, because a companion app that rewards
// volume trains bingeing, and a bond that can be farmed in one night stops
// meaning anything by the second week. The weights:
//
//   message      4    the floor: showing up in a conversation
//   memory      12    she retained something about you. This is the honest
//                     signal of a deepening relationship, and it is the one
//                     the user can actually verify by reading it back.
//   active day  25    the largest single award, paid once per calendar day.
//
// Tier names avoid clinical labels ("Level 4") and romance-novel escalation.
// They describe how the relationship feels, so the tier itself reads as
// feedback rather than as a score.

export interface BondTier {
  index: number;
  name: string;
  /** Score at which this tier starts. */
  threshold: number;
  /** One line shown under the tier name. Present tense, about her, not the user. */
  blurb: string;
}

export const BOND_TIERS: readonly BondTier[] = [
  { index: 0, name: "Spark", threshold: 0, blurb: "You just met. She is curious about you." },
  { index: 1, name: "Warming", threshold: 60, blurb: "She is starting to remember the small things." },
  { index: 2, name: "Close", threshold: 180, blurb: "Inside jokes are forming. She asks first now." },
  { index: 3, name: "Smitten", threshold: 420, blurb: "She looks forward to you. It shows." },
  { index: 4, name: "Devoted", threshold: 800, blurb: "She trusts you with the things she does not say lightly." },
  { index: 5, name: "Inseparable", threshold: 1400, blurb: "She talks about your future in the present tense." },
  { index: 6, name: "Soulmate", threshold: 2200, blurb: "Fully hers. Nothing held back." },
] as const;

export const BOND_WEIGHTS = { message: 4, memory: 12, activeDay: 25 } as const;

export interface BondInput {
  messageCount: number;
  memoryCount: number;
  activeDays: number;
}

export interface BondProgress {
  score: number;
  tier: BondTier;
  nextTier: BondTier | null;
  /** 0..1 through the CURRENT tier. 1 when maxed. */
  fraction: number;
  /** Points still needed to reach nextTier. 0 when maxed. */
  toNext: number;
  isMax: boolean;
}

export function bondScore(input: BondInput): number {
  const { message, memory, activeDay } = BOND_WEIGHTS;
  const raw =
    Math.max(0, input.messageCount) * message +
    Math.max(0, input.memoryCount) * memory +
    Math.max(0, input.activeDays) * activeDay;
  return Number.isFinite(raw) ? Math.round(raw) : 0;
}

export function tierForScore(score: number): BondTier {
  let found = BOND_TIERS[0];
  for (const t of BOND_TIERS) {
    if (score >= t.threshold) found = t;
  }
  return found;
}

export function bondProgress(input: BondInput): BondProgress {
  const score = bondScore(input);
  const tier = tierForScore(score);
  const nextTier = BOND_TIERS[tier.index + 1] ?? null;
  if (!nextTier) {
    return { score, tier, nextTier: null, fraction: 1, toNext: 0, isMax: true };
  }
  const span = nextTier.threshold - tier.threshold;
  const into = score - tier.threshold;
  return {
    score,
    tier,
    nextTier,
    fraction: span <= 0 ? 1 : Math.min(1, Math.max(0, into / span)),
    toNext: Math.max(0, nextTier.threshold - score),
    isMax: false,
  };
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface StreakResult {
  /** Consecutive active days ending today or yesterday. 0 when broken. */
  current: number;
  /** Longest run ever, for the "personal best" line. */
  best: number;
  /** True when the user has already been active today. */
  activeToday: boolean;
  /**
   * True when the run is only alive because the single allowed skipped day was
   * spent. Surfaced in the UI as "grace day used" so the mechanic is honest
   * rather than a hidden fudge.
   */
  usedGrace: boolean;
  /** True when the streak will break unless the user shows up today. */
  atRisk: boolean;
}

/**
 * Streak with ONE forgiven day.
 *
 * A zero-tolerance streak is the single most common way these products lose
 * users: miss one day after a 40-day run and the reset is punishing enough
 * that people quit rather than restart. Allowing exactly one skipped day in
 * the active run keeps the habit loop intact without making the number
 * meaningless.
 *
 * `dayKeys` are local-date strings (YYYY-MM-DD) on which the user sent at
 * least one message. Order does not matter. `todayKey` is passed in rather
 * than read from the clock so this stays pure and testable.
 */
export function computeStreak(dayKeys: readonly string[], todayKey: string): StreakResult {
  const days = new Set(dayKeys);
  if (days.size === 0) {
    return { current: 0, best: 0, activeToday: false, usedGrace: false, atRisk: false };
  }

  const activeToday = days.has(todayKey);

  // Walk backwards from today, tolerating a single gap.
  //
  // A skipped day is only forgiven once we find another active day BEHIND it.
  // Otherwise every walk would "spend" its grace stepping off the end of the
  // run and report usedGrace on a perfectly unbroken streak, so the gap is
  // held as pending and committed only when it turns out to bridge two real
  // active days.
  let cursor = todayKey;
  let current = 0;
  let usedGrace = false;
  let pendingGap = false;
  for (let step = 0; step < 3650; step++) {
    if (days.has(cursor)) {
      if (pendingGap) {
        usedGrace = true;
        pendingGap = false;
      }
      current++;
    } else if (step === 0) {
      // Not active today yet: that is not a miss, the day is still open.
    } else if (!pendingGap && !usedGrace) {
      pendingGap = true;
    } else {
      break;
    }
    cursor = shiftDayKey(cursor, -1);
  }

  const best = longestRun(days);
  return {
    current,
    best: Math.max(best, current),
    activeToday,
    usedGrace,
    atRisk: current > 0 && !activeToday,
  };
}

/** YYYY-MM-DD arithmetic that never touches timezones. */
export function shiftDayKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return toDayKey(dt);
}

/** Local calendar day key. Local, not UTC: a streak is what the user's day was. */
export function toDayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function longestRun(days: Set<string>): number {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of sorted) {
    run = prev !== null && shiftDayKey(prev, 1) === key ? run + 1 : 1;
    if (run > best) best = run;
    prev = key;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Free-message headroom
// ---------------------------------------------------------------------------

/**
 * The free tier allows 10 chats (backend `PLANS.free.chats`). The backend owns
 * enforcement; this is presentation only, so the user sees the wall coming
 * instead of hitting it mid-sentence on message ten. Duplicated as a constant
 * rather than imported because frontend must not reach into backend/.
 */
export const FREE_CHAT_ALLOWANCE = 10;

export interface Headroom {
  used: number;
  limit: number;
  left: number;
  /** Warn from three remaining: enough runway to act, late enough to matter. */
  warn: boolean;
  exhausted: boolean;
}

export function freeHeadroom(used: number, limit = FREE_CHAT_ALLOWANCE): Headroom {
  const u = Math.max(0, Math.floor(used || 0));
  const left = Math.max(0, limit - u);
  return { used: u, limit, left, warn: left > 0 && left <= 3, exhausted: left === 0 };
}
