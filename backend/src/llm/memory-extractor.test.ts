import { describe, expect, it } from "vitest";
import { parseExtractionJson, wordOverlap, VALID_TOPICS } from "./memory-extractor";

describe("parseExtractionJson", () => {
  it("parses raw JSON", () => {
    const out = parseExtractionJson('{"candidates":[{"content":"likes rain","topic":"preference","importance":0.6,"confidence":0.8}]}');
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].topic).toBe("preference");
  });

  it("strips a ```json fence", () => {
    const out = parseExtractionJson("```json\n{\"candidates\":[]}\n```");
    expect(out.candidates).toEqual([]);
  });

  it("returns empty candidates on garbage", () => {
    expect(parseExtractionJson("hello there").candidates).toEqual([]);
  });
});

describe("wordOverlap", () => {
  it("returns 1 for identical text", () => {
    expect(wordOverlap("the user likes rain", "the user likes rain")).toBe(1);
  });

  it("returns >= 0.6 for near-duplicates", () => {
    const a = "user loves quiet rain in the morning";
    const b = "user loves rain in the morning";
    expect(wordOverlap(a, b)).toBeGreaterThanOrEqual(0.6);
  });

  it("returns near 0 for unrelated text", () => {
    expect(wordOverlap("apple orchards", "quantum tunneling")).toBeLessThan(0.2);
  });
});

describe("VALID_TOPICS", () => {
  it("contains the Pellow-derived vocabulary", () => {
    for (const t of ["identity", "preference", "goal", "fear", "history", "relationship", "routine", "emotion", "trivia"]) {
      expect(VALID_TOPICS.has(t)).toBe(true);
    }
  });
});
