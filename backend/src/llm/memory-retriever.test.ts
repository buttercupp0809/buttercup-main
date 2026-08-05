import { describe, expect, it } from "vitest";
import {
  bm25Score,
  recencyScore,
  computeEmotionalResonance,
  renderMemoryBlock,
  W_VECTOR,
  W_BM25,
  W_RECENCY,
  W_IMPORTANCE,
  W_CONFIDENCE,
  W_EMOTIONAL,
} from "./memory-retriever";

describe("weights", () => {
  it("sum to approximately 1.0", () => {
    const s = W_VECTOR + W_BM25 + W_RECENCY + W_IMPORTANCE + W_CONFIDENCE + W_EMOTIONAL;
    expect(s).toBeGreaterThan(0.99);
    expect(s).toBeLessThan(1.01);
  });
});

describe("bm25Score", () => {
  it("is 0 for empty inputs", () => {
    expect(bm25Score("", "hello")).toBe(0);
    expect(bm25Score("hello", "")).toBe(0);
  });
  it("is > 0 when tokens overlap", () => {
    expect(bm25Score("rainy morning walk", "user likes rainy walks")).toBeGreaterThan(0);
  });
  it("is 0 for disjoint tokens", () => {
    expect(bm25Score("quantum", "banana")).toBe(0);
  });
});

describe("recencyScore", () => {
  it("is 1 for a memory created just now", () => {
    const now = new Date();
    expect(recencyScore(now, now)).toBeCloseTo(1, 5);
  });
  it("halves at exactly one half-life (30 days)", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(recencyScore(past, now)).toBeCloseTo(0.5, 3);
  });
  it("decays below 0.25 after two half-lives", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 61 * 24 * 60 * 60 * 1000);
    expect(recencyScore(past, now)).toBeLessThan(0.25);
  });
});

describe("computeEmotionalResonance", () => {
  it("is neutral 0.5 when no current valence provided", () => {
    expect(computeEmotionalResonance(0.8)).toBe(0.5);
  });
  it("is 1 for matching valence", () => {
    expect(computeEmotionalResonance(0.5, 0.5)).toBeCloseTo(1);
  });
  it("is 0 for opposite valence (-1 vs 1)", () => {
    expect(computeEmotionalResonance(-1, 1)).toBe(0);
  });
});

describe("renderMemoryBlock", () => {
  it("returns empty string when nothing to inject", () => {
    expect(renderMemoryBlock([], null)).toBe("");
  });
});
