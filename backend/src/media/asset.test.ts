import { describe, expect, it } from "vitest";
import { _internal } from "./asset";

const { assertTransition, ALLOWED } = _internal;

describe("MediaAsset state machine", () => {
  it("queued -> processing is allowed", () => {
    expect(() => assertTransition("queued", "processing")).not.toThrow();
  });
  it("processing -> ready is allowed", () => {
    expect(() => assertTransition("processing", "ready")).not.toThrow();
  });
  it("queued -> failed is allowed", () => {
    expect(() => assertTransition("queued", "failed")).not.toThrow();
  });
  it("processing -> failed is allowed", () => {
    expect(() => assertTransition("processing", "failed")).not.toThrow();
  });

  it("ready -> anything throws", () => {
    expect(() => assertTransition("ready", "processing")).toThrow(/invalid_transition/);
    expect(() => assertTransition("ready", "failed")).toThrow(/invalid_transition/);
  });
  it("failed -> anything throws", () => {
    expect(() => assertTransition("failed", "ready")).toThrow(/invalid_transition/);
  });
  it("queued -> ready is not allowed (must pass through processing)", () => {
    expect(() => assertTransition("queued", "ready")).toThrow(/invalid_transition/);
  });

  it("ALLOWED is exhaustive for the four statuses", () => {
    expect(Object.keys(ALLOWED).sort()).toEqual(["cold", "failed", "processing", "queued", "ready"].filter((k) => k !== "cold").sort());
  });
});
