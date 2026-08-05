import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPromptLayers, type PromptContext } from "../prompts";

// Golden test: proves the Phase 22 template refactor preserves the
// composed system prompt byte-for-byte against the pre-refactor output
// for two representative contexts (SFW+relationship+null-memory and
// mature+no-relationship+injected-memory). If a template edit needs to
// change model behavior, refresh the fixtures in the SAME commit and
// justify the change in the PR description.

const FIX = join(__dirname, "fixtures");

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

describe("golden prompt equivalence (Phase 22)", () => {
  it("SFW context matches the pre-refactor fixture byte-for-byte", () => {
    const golden = readFileSync(join(FIX, "golden-sfw.txt"), "utf8");
    expect(buildPromptLayers(CTX_SFW)).toBe(golden);
  });

  it("mature + injected-memory context matches the pre-refactor fixture", () => {
    const golden = readFileSync(join(FIX, "golden-mature.txt"), "utf8");
    expect(buildPromptLayers(CTX_MATURE)).toBe(golden);
  });
});
