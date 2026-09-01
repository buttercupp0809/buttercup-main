import { describe, it, expect } from "vitest";
import { captionImage, makeTriggerToken } from "./caption";

describe("caption", () => {
  describe("captionImage", () => {
    it("prefixes the trigger token", async () => {
      const c = await captionImage(
        { imageKey: "k", triggerToken: "ch_abc12345" },
        { vlmCaption: async () => "a woman sitting on a couch" },
      );
      expect(c.startsWith("ch_abc12345")).toBe(true);
    });
  });

  describe("makeTriggerToken", () => {
    it("trigger token matches ch_<8hex>", () => {
      expect(makeTriggerToken("c1")).toMatch(/^ch_[0-9a-f]{8}$/);
    });

    it("is deterministic for the same characterId", () => {
      const token1 = makeTriggerToken("c1");
      const token2 = makeTriggerToken("c1");
      expect(token1).toBe(token2);
    });

    it("produces different tokens for different characterIds", () => {
      const token1 = makeTriggerToken("c1");
      const token2 = makeTriggerToken("c2");
      expect(token1).not.toBe(token2);
    });
  });
});
