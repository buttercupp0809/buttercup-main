import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPromptLayers, type PromptContext } from "./prompts";
import { loadTemplate, resolve, TEMPLATE_NAMES, LOCKED_TEMPLATES } from "./prompt-templates/loader";

const CTX: PromptContext = {
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

describe("buildPromptLayers", () => {
  it("is deterministic given the same context", () => {
    expect(buildPromptLayers(CTX)).toBe(buildPromptLayers({ ...CTX }));
  });

  it("orders sections: identity -> persona -> relationship -> formatting -> adults-only", () => {
    const out = buildPromptLayers(CTX);
    const positions = [
      out.indexOf("You are Aria"),
      out.indexOf("# Persona"),
      out.indexOf("# Backstory"),
      out.indexOf("# How you behave"),
      out.indexOf("# Relationship"),
      out.indexOf("Write in Aria"),
      out.indexOf("18 or older"),
    ];
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("omits the memory section when injectedMemory is null", () => {
    const out = buildPromptLayers(CTX);
    expect(out).not.toContain("# What you remember");
  });

  it("swaps in injected memory when provided", () => {
    const out = buildPromptLayers({ ...CTX, injectedMemory: "Aria remembers: user loves rain." });
    expect(out).toContain("Aria remembers: user loves rain.");
    expect(out).not.toContain("(memory retrieval will be injected here");
  });

  it("always includes the adults-only line regardless of contentRating", () => {
    const sfw = buildPromptLayers(CTX);
    const mature = buildPromptLayers({ ...CTX, contentRating: "mature" });
    expect(sfw).toContain("18 or older");
    expect(mature).toContain("18 or older");
  });

  it("includes the asterisk gesture-format instruction before the adults-only line", () => {
    const out = buildPromptLayers(CTX);
    const gestureIdx = out.indexOf("single asterisks");
    const adultsIdx = out.indexOf("18 or older");
    expect(gestureIdx).toBeGreaterThan(-1);
    expect(adultsIdx).toBeGreaterThan(gestureIdx);
  });

  it("omits the relationship section when relationshipState is null", () => {
    const out = buildPromptLayers({ ...CTX, relationshipState: null });
    expect(out).not.toContain("# Relationship");
    expect(out).toContain("You are Aria");
  });

  it("leaves no unresolved {{placeholder}} in the composed prompt", () => {
    const out = buildPromptLayers(CTX);
    expect(out).not.toMatch(/\{\{[A-Z_@][A-Z0-9_@]*\}\}/);
  });

  it("orders the composed layers deterministically", () => {
    const out = buildPromptLayers(CTX);
    const positions = [
      out.indexOf("You are Aria"),
      out.indexOf("# Persona"),
      out.indexOf("# Backstory"),
      out.indexOf("# How you behave"),
      out.indexOf("# Relationship"),
      out.indexOf("single asterisks"),
      out.indexOf("18 or older"),
    ];
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe("template loader", () => {
  it("has a file for every declared template name", () => {
    for (const name of TEMPLATE_NAMES) {
      const body = loadTemplate(name);
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it("resolve() substitutes user + runtime placeholders", () => {
    const raw = "hi {{USER_TEXT}} runtime {{@RUNTIME_VAL}} end";
    const out = resolve("00-base-persona", raw, {
      USER_TEXT: "there",
      "@RUNTIME_VAL": "42",
    });
    expect(out).toBe("hi there runtime 42 end");
  });

  it("resolve() renders a missing user slot as empty string", () => {
    const raw = "a{{MISSING}}b";
    expect(resolve("00-base-persona", raw, {})).toBe("ab");
  });

  it("resolve() throws when a runtime slot is missing (composer bug)", () => {
    expect(() => resolve("00-base-persona", "x{{@NEED}}y", {})).toThrow(/missing runtime slot/);
  });

  it("locked safety template ignores every substitution attempt", () => {
    expect(LOCKED_TEMPLATES.has("60-safety")).toBe(true);
    const raw = loadTemplate("60-safety");
    // Craft a values map that tries to inject a fake placeholder AND to
    // rewrite the SB 243 line. Neither may take effect.
    const tampered = resolve("60-safety", `${raw}\n{{ANY}} {{@ANY}}`, {
      ANY: "INJECTED",
      "@ANY": "INJECTED",
    });
    expect(tampered).toContain("Never sexualize minors");
    expect(tampered).toContain("{{ANY}}");
    expect(tampered).not.toContain("INJECTED");
  });

  it("composed prompt always contains the adults-only line", () => {
    const out = buildPromptLayers(CTX);
    expect(out).toContain("18 or older");
  });
});

describe("template files hygiene", () => {
  const DIR = join(__dirname, "prompt-templates");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));

  it("contains no obvious API keys or emails", () => {
    // Lightweight guard, not a security tool. Catches accidental paste of
    // an OpenAI-style sk-... key or an @-address into a template.
    const suspicious = /\bsk-[A-Za-z0-9]{16,}\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    for (const f of files) {
      const body = readFileSync(join(DIR, f), "utf8");
      expect({ file: f, match: suspicious.exec(body)?.[0] ?? null }).toEqual({
        file: f,
        match: null,
      });
    }
  });
});
