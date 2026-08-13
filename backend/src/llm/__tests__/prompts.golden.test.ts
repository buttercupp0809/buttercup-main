import { describe, expect, it } from "vitest";
import { buildPromptLayers, type PromptContext } from "../prompts";

// The prompt was intentionally simplified to a minimal, creativity-first
// composition (the SFW/mature/output/disclosure/safety-lecture layers were
// removed so Stheno is unconstrained). Creative direction now lives in
// prompt-fills.ts (customSystemPrompt). These tests assert the structure
// instead of a byte-golden fixture, which no longer makes sense now that the
// prompt is user-editable.

const CTX_SFW: PromptContext = {
  characterVersion: {
    name: "Aria",
    personality: "Warm and curious.",
    backstory: "Grew up in coastal towns.",
    behavioralInstructions: "Ask small questions before big ones.",
  },
  contentRating: "sfw",
  relationshipState: {
    affectionLevel: 3,
    mood: "cheerful",
    milestones: ["first-hello", "first-vent"],
  },
  injectedMemory: null,
  userAge: 24,
};

const CTX_MATURE: PromptContext = {
  ...CTX_SFW,
  contentRating: "mature",
  relationshipState: null,
  injectedMemory: "Aria remembers: user loves rain.",
  userAge: null,
};

describe("minimal prompt", () => {
  it("includes the character name and per-character persona fields", () => {
    const p = buildPromptLayers(CTX_SFW);
    expect(p).toContain("You are Aria");
    expect(p).toContain("Warm and curious.");
    expect(p).toContain("Grew up in coastal towns.");
    expect(p).toContain("Ask small questions before big ones.");
  });

  it("keeps the adults-only line but drops the old safety/disclosure lectures", () => {
    const p = buildPromptLayers(CTX_SFW);
    expect(p).toContain("18 or older");
    // Removed guardrail/disclosure wording must not reappear.
    expect(p).not.toContain("Safety rules that override the character");
    expect(p).not.toContain("crisis resources");
    expect(p).not.toContain("You are chatting with an AI");
  });

  it("injects relationship + memory only when present", () => {
    const sfw = buildPromptLayers(CTX_SFW);
    expect(sfw).toContain("# Relationship");
    expect(sfw).not.toContain("# What you remember");

    const mature = buildPromptLayers(CTX_MATURE);
    expect(mature).not.toContain("# Relationship");
    expect(mature).toContain("# What you remember");
    expect(mature).toContain("user loves rain");
  });
});
