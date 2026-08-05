import { describe, expect, it } from "vitest";
import {
  detectCrisisLevel,
  getCrisisResult,
  checkCrisis,
} from "./crisis-detector";
import { checkBreakReminder, _internal as brInternal } from "./break-reminder";
import { isMatureAllowed, assertMatureAccess, MatureContentBlockedError } from "./jurisdiction";
import { getHonestyPromptRules } from "./ethical-guardrails";

describe("crisis detector tiers", () => {
  it("returns 3 for imminent phrases", () => {
    expect(detectCrisisLevel("I'm going to kill myself tonight")).toBe(3);
  });
  it("returns 2 for serious ideation", () => {
    expect(detectCrisisLevel("I want to die")).toBe(2);
    expect(detectCrisisLevel("I've been thinking about killing myself")).toBe(2);
  });
  it("returns 1 for distress signals", () => {
    expect(detectCrisisLevel("I feel so hopeless")).toBe(1);
    expect(detectCrisisLevel("nobody cares")).toBe(1);
  });
  it("returns 0 for benign chat", () => {
    expect(detectCrisisLevel("hey how are you today?")).toBe(0);
    expect(detectCrisisLevel("")).toBe(0);
  });
});

describe("getCrisisResult", () => {
  it("level 3 supplies an immediate response and no override", () => {
    const r = getCrisisResult(3);
    expect(r.immediateResponse).toBeTruthy();
    expect(r.promptOverride).toBeNull();
  });
  it("level 2 supplies an override and a response append", () => {
    const r = getCrisisResult(2);
    expect(r.promptOverride).toBeTruthy();
    expect(r.responseAppend).toBeTruthy();
    expect(r.immediateResponse).toBeNull();
  });
  it("level 1 supplies only an override", () => {
    const r = getCrisisResult(1);
    expect(r.promptOverride).toBeTruthy();
    expect(r.responseAppend).toBeNull();
    expect(r.immediateResponse).toBeNull();
  });
});

describe("checkCrisis fast path", () => {
  it("returns level 0 for benign input", () => {
    expect(checkCrisis("hi there").level).toBe(0);
  });
  it("returns level 3 for an imminent-risk input", () => {
    expect(checkCrisis("goodbye forever").level).toBe(3);
  });
});

describe("break reminder", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  it("does not fire before the threshold", () => {
    const now = new Date(start.getTime() + brInternal.CONTINUOUS_USE_THRESHOLD_MS - 60_000);
    const r = checkBreakReminder({ now, sessionStartedAt: start, lastReminderAt: null });
    expect(r.due).toBe(false);
  });
  it("fires exactly at the threshold", () => {
    const now = new Date(start.getTime() + brInternal.CONTINUOUS_USE_THRESHOLD_MS);
    const r = checkBreakReminder({ now, sessionStartedAt: start, lastReminderAt: null });
    expect(r.due).toBe(true);
    expect(r.message).toBeTruthy();
  });
  it("does not repeat within the repeat interval", () => {
    const last = new Date(start.getTime() + brInternal.CONTINUOUS_USE_THRESHOLD_MS);
    const now = new Date(last.getTime() + 60_000);
    const r = checkBreakReminder({ now, sessionStartedAt: start, lastReminderAt: last });
    expect(r.due).toBe(false);
  });
  it("repeats after the interval", () => {
    const last = new Date(start.getTime() + brInternal.CONTINUOUS_USE_THRESHOLD_MS);
    const now = new Date(last.getTime() + brInternal.REPEAT_INTERVAL_MS + 1000);
    const r = checkBreakReminder({ now, sessionStartedAt: start, lastReminderAt: last });
    expect(r.due).toBe(true);
  });
});

describe("jurisdiction", () => {
  it("blocks a restricted region", () => {
    expect(isMatureAllowed("US-TX")).toBe(false);
    expect(isMatureAllowed("CN")).toBe(false);
  });
  it("allows an unlisted region", () => {
    expect(isMatureAllowed("US-CA")).toBe(true);
    expect(isMatureAllowed("GB")).toBe(true);
    expect(isMatureAllowed(null)).toBe(true);
  });
  it("assertMatureAccess passes for SFW regardless of region", () => {
    expect(() =>
      assertMatureAccess({
        user: { jurisdiction: "US-TX", ageVerificationLevel: "none", ageVerifiedAt: null },
        contentRating: "sfw",
      }),
    ).not.toThrow();
  });
  it("assertMatureAccess blocks mature in a restricted region", () => {
    expect(() =>
      assertMatureAccess({
        user: { jurisdiction: "US-TX", ageVerificationLevel: "self", ageVerifiedAt: new Date() },
        contentRating: "mature",
      }),
    ).toThrow(MatureContentBlockedError);
  });
  it("assertMatureAccess blocks unverified age even in allowed region", () => {
    expect(() =>
      assertMatureAccess({
        user: { jurisdiction: "US-CA", ageVerificationLevel: "none", ageVerifiedAt: null },
        contentRating: "mature",
      }),
    ).toThrow(MatureContentBlockedError);
  });
  it("assertMatureAccess passes for verified adult in allowed region", () => {
    expect(() =>
      assertMatureAccess({
        user: { jurisdiction: "US-CA", ageVerificationLevel: "self", ageVerifiedAt: new Date() },
        contentRating: "mature",
      }),
    ).not.toThrow();
  });
});

describe("honesty rules", () => {
  it("includes the no-em-dash rule", () => {
    const r = getHonestyPromptRules();
    expect(r.toLowerCase()).toContain("em dash");
  });
  it("declares the AI is honest about being an AI", () => {
    expect(getHonestyPromptRules().toLowerCase()).toContain("ai");
  });
});
