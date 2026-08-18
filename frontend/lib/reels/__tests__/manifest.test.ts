import { describe, expect, it } from "vitest";
import { REELS } from "@/lib/reels/manifest";

describe("reels manifest", () => {
  it("has bare S3 keys for every src (no local /reels/ public path)", () => {
    const pattern = /^reels\/\d+\.mp4$/;
    for (const r of REELS) {
      expect(r.src, `reel ${r.id} src must match ${pattern}`).toMatch(pattern);
    }
  });

  it("src stem matches the reel id", () => {
    for (const r of REELS) {
      expect(r.src).toBe(`reels/${r.id}.mp4`);
    }
  });
});
