// Guards the two-entry TESTIMONIALS array from silent drift. Copy is
// editorial, so we do not snapshot it; we just assert shape + length.

import { describe, expect, it } from "vitest";
import { TESTIMONIALS } from "./SocialProof";

describe("SocialProof TESTIMONIALS", () => {
  it("has exactly two entries", () => {
    expect(TESTIMONIALS).toHaveLength(2);
  });

  it("every entry has quote / name / handle / role strings", () => {
    for (const t of TESTIMONIALS) {
      expect(typeof t.quote).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.handle).toBe("string");
      expect(typeof t.role).toBe("string");
      expect(t.quote.length).toBeGreaterThan(0);
      expect(t.handle.startsWith("@")).toBe(true);
    }
  });
});
