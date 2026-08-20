// Regression tests for the token-preservation guard added by
// Plans/cursor-prompt/35-major-fixes-batch.md #D.2 step 4.
//
// Two contracts:
//   - extractGuardTokens: pulls concrete words out of the user's fragment
//     while dropping high-frequency English stopwords.
//   - ensureGuardTokens: appends missing tokens verbatim to the enriched
//     prompt so the downstream image model always sees the user's
//     concrete words (outfit, place, pose, colors).

import { describe, it, expect } from "vitest";
import { extractGuardTokens, ensureGuardTokens } from "../image-turn";

describe("extractGuardTokens", () => {
  it("returns empty on empty input", () => {
    expect(extractGuardTokens("")).toEqual([]);
  });

  it("drops stopwords and short words", () => {
    expect(extractGuardTokens("in a red dress")).toEqual(["red", "dress"]);
  });

  it("deduplicates case-insensitively while preserving first case", () => {
    expect(extractGuardTokens("red Red RED velvet")).toEqual(["red", "velvet"]);
  });

  it("keeps concrete nouns and adjectives", () => {
    expect(extractGuardTokens("wearing a red dress at the beach")).toEqual([
      "wearing",
      "red",
      "dress",
      "beach",
    ]);
  });
});

describe("ensureGuardTokens", () => {
  it("noop when all tokens present", () => {
    const enriched = "A vivid portrait of a woman in a red dress at the beach";
    expect(ensureGuardTokens(enriched, ["red", "dress", "beach"])).toBe(enriched);
  });

  it("appends only the missing tokens", () => {
    const enriched = "A vivid portrait of a woman";
    expect(ensureGuardTokens(enriched, ["red", "dress", "beach"])).toBe(
      "A vivid portrait of a woman, red, dress, beach",
    );
  });

  it("empty guard tokens is a noop", () => {
    expect(ensureGuardTokens("anything", [])).toBe("anything");
  });

  it("case-insensitive match: does not duplicate", () => {
    const enriched = "A photo with RED accents";
    expect(ensureGuardTokens(enriched, ["red"])).toBe(enriched);
  });
});
