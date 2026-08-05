import { describe, expect, it } from "vitest";
import { parseGestures } from "@/lib/gesture-format";

describe("parseGestures", () => {
  it("returns [] for empty input", () => {
    expect(parseGestures("")).toEqual([]);
  });

  it("splits a matched pair from trailing text", () => {
    expect(parseGestures("*she smiles* hello")).toEqual([
      { kind: "gesture", value: "she smiles" },
      { kind: "text", value: " hello" },
    ]);
  });

  it("keeps a trailing unmatched * as plain pending text", () => {
    // "hi *she smil" -> one merged plain text run; nothing flips italic.
    expect(parseGestures("hi *she smil")).toEqual([
      { kind: "text", value: "hi *she smil" },
    ]);
  });

  it("streaming: half-open renders plain, closes into a gesture", () => {
    const partial = parseGestures("*she smil");
    expect(partial.every((s) => s.kind === "text")).toBe(true);
    const closed = parseGestures("*she smiles*");
    expect(closed).toEqual([{ kind: "gesture", value: "she smiles" }]);
  });

  it("flat model: inner * closes the open gesture, no overlap", () => {
    // *a*b* -> gesture a, text b, dangling * (renders plain).
    expect(parseGestures("*a*b*")).toEqual([
      { kind: "gesture", value: "a" },
      { kind: "text", value: "b*" },
    ]);
  });

  it("empty pair ** collapses to nothing", () => {
    expect(parseGestures("**")).toEqual([]);
    expect(parseGestures("x**y")).toEqual([{ kind: "text", value: "xy" }]);
  });

  it("escaped \\* renders as a literal asterisk, never a delimiter", () => {
    expect(parseGestures("2 \\* 3 = 6")).toEqual([
      { kind: "text", value: "2 * 3 = 6" },
    ]);
  });

  it("escaped \\* inside a gesture is preserved as a literal", () => {
    expect(parseGestures("*a\\*b*")).toEqual([
      { kind: "gesture", value: "a*b" },
    ]);
  });

  it("merges adjacent text runs", () => {
    // Two gestures back-to-back separated only by whitespace.
    expect(parseGestures("*a* *b*end")).toEqual([
      { kind: "gesture", value: "a" },
      { kind: "text", value: " " },
      { kind: "gesture", value: "b" },
      { kind: "text", value: "end" },
    ]);
  });
});
