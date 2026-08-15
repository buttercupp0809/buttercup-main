import { describe, expect, it } from "vitest";
import { _internal } from "../dreaming";

const { clusterMemories, parseClusterOut } = _internal;

function fixedMem(id: string, embedding: number[], createdAt: Date) {
  return { id, content: `content ${id}`, createdAt, category: "trivia", importance: 0.5, embedding };
}

describe("dreaming clustering (pure, no DB)", () => {
  it("clusters deterministically across repeated runs on fixed embeddings", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const mems = [
      fixedMem("a", [1, 0, 0], new Date(base.getTime() + 0)),
      fixedMem("b", [0.98, 0.02, 0], new Date(base.getTime() + 1000)),
      fixedMem("c", [0, 1, 0], new Date(base.getTime() + 2000)),
      fixedMem("d", [0.01, 0.99, 0], new Date(base.getTime() + 3000)),
      fixedMem("e", [0, 0, 1], new Date(base.getTime() + 4000)),
    ];
    const run1 = clusterMemories(mems as never);
    const run2 = clusterMemories(mems as never);
    expect(run1).toEqual(run2);
    // a+b cluster, c+d cluster, e is a singleton and dropped (min cluster size 2).
    expect(run1.length).toBe(2);
    const idsPerCluster = run1.map((c) => c.map((m) => m.id).sort());
    expect(idsPerCluster).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops clusters below the minimum size", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const mems = [
      fixedMem("x", [1, 0, 0], base),
      fixedMem("y", [0, 1, 0], new Date(base.getTime() + 1000)),
      fixedMem("z", [0, 0, 1], new Date(base.getTime() + 2000)),
    ];
    const clusters = clusterMemories(mems as never);
    expect(clusters).toEqual([]);
  });
});

describe("parseClusterOut (pure)", () => {
  it("parses a well-formed cluster LLM response", () => {
    const raw = JSON.stringify({
      derivedEdges: [{ sourceContent: "a", targetContent: "b", label: "same theme" }],
      insight: { content: "user is stressed about work deadlines", category: "emotion", importance: "medium" },
    });
    const parsed = parseClusterOut(raw);
    expect(parsed?.derivedEdges).toHaveLength(1);
    expect(parsed?.insight?.content).toBe("user is stressed about work deadlines");
  });

  it("strips a markdown fence", () => {
    const parsed = parseClusterOut("```json\n{\"derivedEdges\":[]}\n```");
    expect(parsed?.derivedEdges).toEqual([]);
  });

  it("returns null on unparseable input", () => {
    expect(parseClusterOut("not json at all")).toBeNull();
  });
});
