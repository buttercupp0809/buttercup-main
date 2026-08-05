import { describe, expect, it } from "vitest";
import { affectionPercent, clampAffection } from "@/lib/relationship";

describe("clampAffection", () => {
  it("returns 0 for negatives", () => {
    expect(clampAffection(-5)).toBe(0);
    expect(clampAffection(-9999)).toBe(0);
  });
  it("returns 100 for values above 100", () => {
    expect(clampAffection(101)).toBe(100);
    expect(clampAffection(1_000_000)).toBe(100);
  });
  it("returns rounded value in range", () => {
    expect(clampAffection(42)).toBe(42);
    expect(clampAffection(42.7)).toBe(43);
  });
  it("returns 0 for non-finite input", () => {
    expect(clampAffection(NaN)).toBe(0);
    expect(clampAffection(Infinity)).toBe(0);
  });
});

describe("affectionPercent", () => {
  it("mirrors clampAffection", () => {
    expect(affectionPercent(0)).toBe(0);
    expect(affectionPercent(50)).toBe(50);
    expect(affectionPercent(150)).toBe(100);
  });
});
