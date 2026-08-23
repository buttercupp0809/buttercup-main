import { describe, it, expect } from "vitest";
import { BULK_SCENARIOS, scenarioForIndex } from "./bulk-scenarios";

describe("bulk-scenarios", () => {
  it("BULK_SCENARIOS has exactly 10 entries", () => {
    expect(BULK_SCENARIOS.length).toBe(10);
  });

  it("all prompts are non-empty strings", () => {
    BULK_SCENARIOS.forEach((scenario) => {
      expect(typeof scenario.prompt).toBe("string");
      expect(scenario.prompt.length).toBeGreaterThan(0);
    });
  });

  it("all titles are unique", () => {
    const titles = BULK_SCENARIOS.map((s) => s.title);
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBe(titles.length);
  });

  it("scenarioForIndex(0) returns BULK_SCENARIOS[0]", () => {
    expect(scenarioForIndex(0)).toBe(BULK_SCENARIOS[0]);
  });

  it("scenarioForIndex(9) returns BULK_SCENARIOS[9]", () => {
    expect(scenarioForIndex(9)).toBe(BULK_SCENARIOS[9]);
  });

  it("scenarioForIndex(10) wraps to BULK_SCENARIOS[0]", () => {
    expect(scenarioForIndex(10)).toBe(BULK_SCENARIOS[0]);
  });

  it("scenarioForIndex(11) wraps to BULK_SCENARIOS[1]", () => {
    expect(scenarioForIndex(11)).toBe(BULK_SCENARIOS[1]);
  });

  it("scenarioForIndex(142) returns BULK_SCENARIOS[2]", () => {
    expect(scenarioForIndex(142)).toBe(BULK_SCENARIOS[142 % 10]);
    expect(scenarioForIndex(142)).toBe(BULK_SCENARIOS[2]);
  });
});
