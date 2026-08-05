import { describe, expect, it } from "vitest";
import { topTagsFrom } from "@/lib/characters";

describe("topTagsFrom", () => {
  it("returns [] for empty input", () => {
    expect(topTagsFrom([])).toEqual([]);
  });

  it("counts, dedupes, and caps to limit", () => {
    const lists = [
      ["romance", "sci-fi", "romance"],
      ["romance", "mystery"],
      ["sci-fi", "mystery", "mystery"],
    ];
    const top = topTagsFrom(lists, 2);
    // romance:3, mystery:3, sci-fi:2 -> ties broken alphabetically
    expect(top).toEqual(["mystery", "romance"]);
  });

  it("trims and drops empty strings", () => {
    const top = topTagsFrom([["  cozy  ", ""], [" cozy"]]);
    expect(top).toEqual(["cozy"]);
  });

  it("ignores non-array entries defensively", () => {
    const top = topTagsFrom([
      ["a"],
      undefined as unknown as string[],
      ["a", "b"],
    ]);
    expect(top).toEqual(["a", "b"]);
  });
});
