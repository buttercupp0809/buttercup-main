import { describe, expect, it, beforeEach } from "vitest";
import {
  incrementCounter,
  getCounter,
  recordLatency,
  getLatencyP95,
  recordProviderOutcome,
  recordMediaJobOutcome,
  getFallbackRate,
  getHealthSnapshot,
  _resetMetrics,
} from "./metrics";

beforeEach(() => _resetMetrics());

describe("metrics", () => {
  it("counters increment", () => {
    incrementCounter("chat");
    incrementCounter("chat", 4);
    expect(getCounter("chat")).toBe(5);
    expect(getCounter("nothing")).toBe(0);
  });

  it("p95 approximates the 95th percentile", () => {
    for (let i = 1; i <= 100; i++) recordLatency("llm", i * 10);
    const p95 = getLatencyP95("llm");
    expect(p95).toBeGreaterThanOrEqual(950);
    expect(p95).toBeLessThanOrEqual(1000);
  });

  it("provider outcomes and fallback rate", () => {
    recordProviderOutcome({ provider: "openrouter", success: true });
    recordProviderOutcome({ provider: "openrouter", success: false });
    recordProviderOutcome({ provider: "anthropic", success: true, fallback: true });
    expect(getFallbackRate()).toBeCloseTo(1 / 3, 5);
  });

  it("media outcomes bucket by kind", () => {
    recordMediaJobOutcome({ kind: "voice", status: "ok" });
    recordMediaJobOutcome({ kind: "voice", status: "failed" });
    recordMediaJobOutcome({ kind: "image", status: "ok" });
    const snap = getHealthSnapshot();
    expect(snap.media.voice.ok).toBe(1);
    expect(snap.media.voice.failed).toBe(1);
    expect(snap.media.image.ok).toBe(1);
  });
});
