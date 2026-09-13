import { describe, it, expect } from "vitest";
import { validateLora } from "./validate";

describe("validateLora", () => {
  it("selects the best checkpoint and passes only when it beats baseline", async () => {
    const r = await validateLora(
      {
        referenceKey: "r",
        checkpoints: [
          { step: 500, key: "a" },
          { step: 750, key: "b" },
        ],
        promptSet: ["p1", "p2"],
      },
      {
        baseline: async () => 0.7,
        scoreChain: async (_ref, ck) => (ck === "b" ? 0.82 : 0.66),
      },
    );
    expect(r.bestKey).toBe("b");
    expect(r.bestStep).toBe(750);
    expect(r.meanScore).toBe(0.82);
    expect(r.baselineScore).toBe(0.7);
    expect(r.pass).toBe(true);
  });

  it("fails when the best checkpoint score is below baseline", async () => {
    const r = await validateLora(
      {
        referenceKey: "ref",
        checkpoints: [
          { step: 100, key: "ckpt1" },
          { step: 200, key: "ckpt2" },
        ],
        promptSet: ["prompt_a", "prompt_b"],
      },
      {
        baseline: async () => 0.85,
        scoreChain: async (_ref, ck) => (ck === "ckpt2" ? 0.75 : 0.6),
      },
    );
    expect(r.bestKey).toBe("ckpt2");
    expect(r.meanScore).toBe(0.75);
    expect(r.pass).toBe(false);
  });

  it("passes when best checkpoint score equals baseline exactly", async () => {
    const r = await validateLora(
      {
        referenceKey: "ref",
        checkpoints: [{ step: 500, key: "best" }],
        promptSet: ["p1"],
      },
      {
        baseline: async () => 0.8,
        scoreChain: async () => 0.8,
      },
    );
    expect(r.pass).toBe(true);
  });

  it("handles multiple checkpoints and selects the highest score", async () => {
    const scores: Record<string, number> = {
      low: 0.5,
      mid: 0.7,
      high: 0.95,
    };
    const r = await validateLora(
      {
        referenceKey: "r",
        checkpoints: [
          { step: 100, key: "low" },
          { step: 200, key: "mid" },
          { step: 300, key: "high" },
        ],
        promptSet: ["p"],
      },
      {
        baseline: async () => 0.6,
        scoreChain: async (_ref, ck) => scores[ck] ?? 0,
      },
    );
    expect(r.bestKey).toBe("high");
    expect(r.bestStep).toBe(300);
    expect(r.meanScore).toBe(0.95);
  });

  it("respects the referenceKey passed to scoreChain", async () => {
    let capturedRefKey = "";
    await validateLora(
      {
        referenceKey: "custom_ref_123",
        checkpoints: [{ step: 500, key: "ckpt" }],
        promptSet: ["p"],
      },
      {
        baseline: async () => 0.7,
        scoreChain: async (refKey) => {
          capturedRefKey = refKey;
          return 0.8;
        },
      },
    );
    expect(capturedRefKey).toBe("custom_ref_123");
  });

  it("throws a clear error when given an empty checkpoint list", async () => {
    let scoreChainCalled = false;
    await expect(
      validateLora(
        {
          referenceKey: "r",
          checkpoints: [],
          promptSet: ["p"],
        },
        {
          baseline: async () => 0.7,
          scoreChain: async () => {
            scoreChainCalled = true;
            return 0.8;
          },
        },
      ),
    ).rejects.toThrow("no checkpoints produced by training");
    // Must fail fast before touching the scoring deps.
    expect(scoreChainCalled).toBe(false);
  });

  it("calls scoreChain once per checkpoint", async () => {
    let callCount = 0;
    await validateLora(
      {
        referenceKey: "r",
        checkpoints: [
          { step: 100, key: "a" },
          { step: 200, key: "b" },
          { step: 300, key: "c" },
        ],
        promptSet: ["p1", "p2", "p3"],
      },
      {
        baseline: async () => 0.7,
        scoreChain: async () => {
          callCount++;
          return 0.75;
        },
      },
    );
    expect(callCount).toBe(3);
  });
});
