import { describe, expect, it } from "vitest";
import {
  BOND_TIERS,
  bondProgress,
  bondScore,
  computeStreak,
  freeHeadroom,
  shiftDayKey,
  tierForScore,
} from "@/lib/bond";

describe("bondScore", () => {
  it("is zero for a brand-new pairing", () => {
    expect(bondScore({ messageCount: 0, memoryCount: 0, activeDays: 0 })).toBe(0);
  });

  it("weights an active day above a single message", () => {
    const day = bondScore({ messageCount: 0, memoryCount: 0, activeDays: 1 });
    const msg = bondScore({ messageCount: 1, memoryCount: 0, activeDays: 0 });
    expect(day).toBeGreaterThan(msg);
  });

  it("rewards ten days of talking over one binge of the same message count", () => {
    // The whole point of the weighting: consistency must beat volume, or the
    // bond can be farmed in a single sitting.
    const binge = bondScore({ messageCount: 100, memoryCount: 2, activeDays: 1 });
    const habit = bondScore({ messageCount: 100, memoryCount: 2, activeDays: 10 });
    expect(habit).toBeGreaterThan(binge);
  });

  it("ignores negative and non-finite input", () => {
    expect(bondScore({ messageCount: -50, memoryCount: -1, activeDays: -3 })).toBe(0);
    expect(bondScore({ messageCount: NaN, memoryCount: 0, activeDays: 0 })).toBe(0);
  });
});

describe("tierForScore", () => {
  it("starts at Spark", () => {
    expect(tierForScore(0).name).toBe("Spark");
    expect(tierForScore(59).name).toBe("Spark");
  });

  it("lands exactly on a threshold", () => {
    for (const t of BOND_TIERS) {
      expect(tierForScore(t.threshold).name).toBe(t.name);
    }
  });

  it("caps at the top tier", () => {
    expect(tierForScore(999_999).name).toBe("Soulmate");
  });
});

describe("bondProgress", () => {
  it("reports fraction through the current tier", () => {
    // Spark spans 0..60, so a score of 30 is halfway.
    const p = bondProgress({ messageCount: 0, memoryCount: 0, activeDays: 0 });
    expect(p.fraction).toBe(0);
    expect(p.tier.name).toBe("Spark");
    expect(p.nextTier?.name).toBe("Warming");
    expect(p.toNext).toBe(60);
  });

  it("saturates at the max tier without a next tier", () => {
    const p = bondProgress({ messageCount: 10_000, memoryCount: 500, activeDays: 400 });
    expect(p.isMax).toBe(true);
    expect(p.nextTier).toBeNull();
    expect(p.fraction).toBe(1);
    expect(p.toNext).toBe(0);
  });

  it("keeps fraction within 0..1", () => {
    for (const days of [0, 1, 5, 20, 100, 365]) {
      const p = bondProgress({ messageCount: days * 6, memoryCount: days, activeDays: days });
      expect(p.fraction).toBeGreaterThanOrEqual(0);
      expect(p.fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe("shiftDayKey", () => {
  it("moves across a month boundary", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("moves across a year boundary", () => {
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftDayKey("2024-03-01", -1)).toBe("2024-02-29");
  });
});

describe("computeStreak", () => {
  const today = "2026-08-18";

  it("is zero with no activity", () => {
    const s = computeStreak([], today);
    expect(s.current).toBe(0);
    expect(s.best).toBe(0);
    expect(s.activeToday).toBe(false);
    expect(s.atRisk).toBe(false);
  });

  it("counts a single day active today", () => {
    const s = computeStreak([today], today);
    expect(s.current).toBe(1);
    expect(s.activeToday).toBe(true);
    expect(s.atRisk).toBe(false);
  });

  it("counts consecutive days ending today", () => {
    const s = computeStreak(["2026-08-16", "2026-08-17", "2026-08-18"], today);
    expect(s.current).toBe(3);
    expect(s.usedGrace).toBe(false);
  });

  it("keeps the streak alive before the user shows up today, and flags it at risk", () => {
    // Today is still open: not having messaged yet must not break the run.
    const s = computeStreak(["2026-08-16", "2026-08-17"], today);
    expect(s.current).toBe(2);
    expect(s.activeToday).toBe(false);
    expect(s.atRisk).toBe(true);
  });

  it("forgives exactly one missed day", () => {
    // Missed the 16th, talked on the 14th, 15th, 17th and 18th.
    const s = computeStreak(
      ["2026-08-14", "2026-08-15", "2026-08-17", "2026-08-18"],
      today,
    );
    expect(s.current).toBe(4);
    expect(s.usedGrace).toBe(true);
  });

  it("breaks on two missed days in a row", () => {
    // Gap on the 16th and 17th ends the run at today.
    const s = computeStreak(["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-18"], today);
    expect(s.current).toBe(1);
  });

  it("does not credit a grace day when nothing precedes it", () => {
    const s = computeStreak(["2026-01-01"], today);
    expect(s.current).toBe(0);
    expect(s.usedGrace).toBe(false);
  });

  it("reports the best run even when the current one is broken", () => {
    const s = computeStreak(
      ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"],
      today,
    );
    expect(s.current).toBe(0);
    expect(s.best).toBe(5);
  });

  it("is order independent and ignores duplicates", () => {
    const a = computeStreak(["2026-08-18", "2026-08-16", "2026-08-17"], today);
    const b = computeStreak(["2026-08-17", "2026-08-18", "2026-08-16", "2026-08-18"], today);
    expect(a.current).toBe(b.current);
    expect(b.current).toBe(3);
  });
});

describe("freeHeadroom", () => {
  it("reports a full allowance for a new user", () => {
    const h = freeHeadroom(0);
    expect(h.left).toBe(10);
    expect(h.warn).toBe(false);
    expect(h.exhausted).toBe(false);
  });

  it("warns from three remaining", () => {
    expect(freeHeadroom(6).warn).toBe(false);
    expect(freeHeadroom(7).warn).toBe(true);
    expect(freeHeadroom(9).warn).toBe(true);
  });

  it("reports exhaustion without warning at zero left", () => {
    const h = freeHeadroom(10);
    expect(h.left).toBe(0);
    expect(h.exhausted).toBe(true);
    expect(h.warn).toBe(false);
  });

  it("never goes negative when the backend counted past the limit", () => {
    expect(freeHeadroom(45).left).toBe(0);
  });
});
