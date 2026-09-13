import { describe, it, expect } from "vitest";
import { buildDataset } from "./dataset";

describe("buildDataset", () => {
  it("curates: drops candidates below the arcface threshold and caps at targetCount", async () => {
    const fakeGallery = ["g1", "g2", "g3"];
    const scores: Record<string, number> = { g1: 0.9, g2: 0.4, g3: 0.85 };
    const out = await buildDataset(
      { characterId: "c1", characterVersionId: "v1", targetCount: 2 },
      {
        listGallery: async () => fakeGallery,
        score: async (_r, k) => scores[k] ?? 0,
        genTurntable: async () => [],
        uploadManifest: async () => "m.json",
      },
    );
    expect(out.images.map((i) => i.key)).not.toContain("g2");
    expect(out.images.length).toBeLessThanOrEqual(2);
  });

  it("includes turntable images that pass the threshold", async () => {
    const out = await buildDataset(
      { characterId: "c1", characterVersionId: "v1", targetCount: 10 },
      {
        listGallery: async () => [],
        score: async (_r, k) => (k === "t_low" ? 0.3 : 0.75),
        genTurntable: async () => ["t_high", "t_low"],
        uploadManifest: async () => "manifest.json",
      },
    );
    expect(out.images.map((i) => i.key)).toContain("t_high");
    expect(out.images.map((i) => i.key)).not.toContain("t_low");
  });

  it("returns the manifestKey from uploadManifest", async () => {
    const out = await buildDataset(
      { characterId: "c1", characterVersionId: "v1", targetCount: 5 },
      {
        listGallery: async () => ["g1"],
        score: async () => 0.9,
        genTurntable: async () => [],
        uploadManifest: async () => "lora/c1/v1/manifest.json",
      },
    );
    expect(out.manifestKey).toBe("lora/c1/v1/manifest.json");
  });

  it("sorts images by arcfaceScore descending", async () => {
    const scores: Record<string, number> = { a: 0.7, b: 0.95, c: 0.8 };
    const out = await buildDataset(
      { characterId: "c1", characterVersionId: "v1", targetCount: 10 },
      {
        listGallery: async () => ["a", "b", "c"],
        score: async (_r, k) => scores[k] ?? 0,
        genTurntable: async () => [],
        uploadManifest: async () => "x.json",
      },
    );
    const sc = out.images.map((i) => i.arcfaceScore);
    for (let i = 1; i < sc.length; i++) {
      expect(sc[i - 1]).toBeGreaterThanOrEqual(sc[i]);
    }
  });

  it("passes the correct manifest payload to uploadManifest", async () => {
    let captured: unknown;
    await buildDataset(
      { characterId: "c1", characterVersionId: "v1", targetCount: 5 },
      {
        listGallery: async () => ["g1"],
        score: async () => 0.9,
        genTurntable: async () => [],
        uploadManifest: async (manifest) => {
          captured = manifest;
          return "out.json";
        },
      },
    );
    expect(captured).toMatchObject({
      characterId: "c1",
      characterVersionId: "v1",
      images: expect.arrayContaining([
        expect.objectContaining({ key: "g1", kind: "gallery", arcfaceScore: 0.9 }),
      ]),
    });
  });
});
