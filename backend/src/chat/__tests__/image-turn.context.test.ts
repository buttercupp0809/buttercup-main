// Feature 33.1 tests: context-aware in-chat image generation. All external
// dependencies (Prisma, memory-retriever, Stheno HTTP endpoint, image
// providers, storage/asset writes, WebP conversion) are mocked so the tests
// run offline and deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prisma singleton mock: expose spy handles for message.findMany and
// conversation.findUnique so individual tests can override behavior.
const messageFindMany = vi.fn();
const conversationFindUnique = vi.fn();
const characterMediaFindFirst = vi.fn();
const characterMediaCreate = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    message: { findMany: messageFindMany },
    conversation: { findUnique: conversationFindUnique },
    characterMedia: { findFirst: characterMediaFindFirst, create: characterMediaCreate },
  },
}));

const getLatestSummaryMock = vi.fn();
vi.mock("../../llm/memory-retriever", () => ({
  getLatestSummary: getLatestSummaryMock,
}));

vi.mock("../../inference/poppyEndpoint", () => ({
  resolvePoppyBaseUrl: vi.fn().mockResolvedValue("http://stheno.local"),
}));

const generateImageMock = vi.fn();
const generateConsistentMock = vi.fn();
vi.mock("../../media/image/providers", () => ({
  generateImage: generateImageMock,
  generateWithComfyUIConsistent: generateConsistentMock,
}));

vi.mock("../../media/image/convert", () => ({
  toWebP: vi.fn().mockResolvedValue({ buffer: Buffer.from("webp-bytes"), contentType: "image/webp" }),
}));

vi.mock("../../media/storage", () => ({
  uploadGenerated: vi.fn().mockResolvedValue("images/fake.webp"),
  canUploadToS3: vi.fn().mockReturnValue(false),
  getGeneratedSignedUrl: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock("../../media/asset", () => ({
  createReadyAsset: vi.fn().mockResolvedValue({ id: "asset-1" }),
}));

// enrichImagePrompt now routes through callLLM (the provider chain), not a
// direct Stheno fetch, so enrichment survives a GPU-box outage (see
// Plans/cursor-prompt/35-major-fixes-batch.md #D.3). Expose a handle so each
// test can drive the enrichment result.
const callLLMMock = vi.fn();
vi.mock("../../llm/provider", () => ({
  callLLM: (...a: unknown[]) => callLLMMock(...a),
}));

// Import after mocks so the module resolves against the stubs above.
const { buildImageContext, enrichImagePrompt, generateChatImage, IMAGE_CONTEXT_TURNS } = await import(
  "../image-turn"
);

function makeMsg(role: "user" | "assistant", content: string, offsetMs: number) {
  return { role, content, createdAt: new Date(Date.now() - offsetMs) };
}

beforeEach(() => {
  messageFindMany.mockReset();
  conversationFindUnique.mockReset();
  characterMediaFindFirst.mockReset().mockResolvedValue(null);
  characterMediaCreate.mockReset();
  getLatestSummaryMock.mockReset().mockResolvedValue(null);
  generateImageMock.mockReset();
  generateConsistentMock.mockReset();
  // Default: a successful non-hardcoded enrichment. Individual tests override.
  callLLMMock.mockReset().mockResolvedValue({ text: "teaser", provider: "openrouter" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IMAGE_CONTEXT_TURNS", () => {
  it("is clamped into [10, 20]", () => {
    expect(IMAGE_CONTEXT_TURNS).toBeGreaterThanOrEqual(10);
    expect(IMAGE_CONTEXT_TURNS).toBeLessThanOrEqual(20);
  });
});

describe("buildImageContext", () => {
  it("returns chronological turns within [10, 20] with data:image scrubbed", async () => {
    conversationFindUnique.mockResolvedValueOnce({
      characterId: "char-1",
      character: { name: "Aria" },
    });
    getLatestSummaryMock.mockResolvedValueOnce({ summary: "They met at a rooftop bar." });

    // Prisma is called with orderBy desc, so return newest first. The builder
    // reverses them into chronological order.
    const desc = [
      makeMsg("assistant", "newest reply", 0),
      makeMsg("user", "data:image/png;base64,AAAABBBBCCCC", 1_000),
      makeMsg("assistant", "prefix data:image/jpeg;base64,ZZZ suffix", 2_000),
      makeMsg("user", "hey", 3_000),
      makeMsg("assistant", "hi", 4_000),
      makeMsg("user", "u there?", 5_000),
      makeMsg("assistant", "yes", 6_000),
      makeMsg("user", "cool", 7_000),
      makeMsg("assistant", "yep", 8_000),
      makeMsg("user", "oldest of ten", 9_000),
    ];
    messageFindMany.mockResolvedValueOnce(desc);

    const ctx = await buildImageContext("conv-1", "user-1");

    const takeArg = messageFindMany.mock.calls[0][0];
    expect(takeArg.take).toBe(IMAGE_CONTEXT_TURNS);
    expect(takeArg.orderBy).toEqual({ createdAt: "desc" });

    // Base64 payloads must never leak.
    expect(ctx.recentTurns).not.toMatch(/data:image/);
    expect(ctx.recentTurns).toContain("[shared a photo]");

    // Chronological: the oldest line appears before the newest reply.
    const oldestIdx = ctx.recentTurns.indexOf("oldest of ten");
    const newestIdx = ctx.recentTurns.indexOf("newest reply");
    expect(oldestIdx).toBeGreaterThanOrEqual(0);
    expect(newestIdx).toBeGreaterThan(oldestIdx);

    // Line count matches the fixture size (10, within the [10, 20] window).
    const lineCount = ctx.recentTurns.split("\n").length;
    expect(lineCount).toBeGreaterThanOrEqual(10);
    expect(lineCount).toBeLessThanOrEqual(20);

    expect(ctx.summary).toBe("They met at a rooftop bar.");

    // characterId is surfaced so generateChatImage can reuse it without a
    // second conversation.findUnique query.
    expect(ctx.characterId).toBe("char-1");
  });

  it("returns empty context (no throw) when the DB call rejects", async () => {
    conversationFindUnique.mockResolvedValueOnce({
      characterId: "char-1",
      character: { name: "Aria" },
    });
    messageFindMany.mockRejectedValueOnce(new Error("db down"));

    const ctx = await buildImageContext("conv-1", "user-1");
    expect(ctx).toEqual({ recentTurns: "", summary: "", characterId: null });
  });
});

describe("enrichImagePrompt", () => {
  const RAW = "a woman on a beach at sunset, red dress, arms raised";

  it("sends PRIMARY == raw prompt verbatim and BACKGROUND with summary + turns via callLLM", async () => {
    callLLMMock.mockResolvedValueOnce({ text: "ENRICHED", provider: "openrouter" });

    const result = await enrichImagePrompt(RAW, {
      summary: "Rooftop meetup, playful mood.",
      recentTurns: "User: hey\nAria: hi there",
    });

    // The enriched text is returned, with any dropped user tokens re-appended
    // by the guard. "ENRICHED" contains none of them, so all survive.
    expect(result.startsWith("ENRICHED")).toBe(true);
    expect(result.toLowerCase()).toContain("beach");

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    const arg = callLLMMock.mock.calls[0][0];
    // Prompt-shaping, not creative writing: low temperature locks user tokens.
    expect(arg.temperature).toBeCloseTo(0.15, 5);
    expect(arg.purpose).toBe("extract");
    expect(typeof arg.systemPrompt).toBe("string");
    const userMsg = arg.messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg).toBeDefined();
    const content: string = userMsg.content;

    // PRIMARY block: the raw prompt appears verbatim right after the header.
    expect(content).toContain("PRIMARY IMAGE REQUEST");
    const primaryIdx = content.indexOf("PRIMARY IMAGE REQUEST");
    const bgIdx = content.indexOf("BACKGROUND CONTEXT");
    expect(bgIdx).toBeGreaterThan(primaryIdx);
    const primaryBlock = content.slice(primaryIdx, bgIdx);
    expect(primaryBlock).toContain(RAW);

    // MUST-PRESERVE tokens are listed for the model.
    expect(content).toContain("MUST-PRESERVE TOKENS");

    // BACKGROUND block contains the summary and the recent turns.
    const backgroundBlock = content.slice(bgIdx);
    expect(backgroundBlock).toContain("Rooftop meetup, playful mood.");
    expect(backgroundBlock).toContain("User: hey");
    expect(backgroundBlock).toContain("Aria: hi there");
  });

  it("returns raw prompt (guard tokens already present) when the chain falls back to hardcoded", async () => {
    callLLMMock.mockResolvedValueOnce({ text: "ignored canned line", provider: "hardcoded" });
    const out = await enrichImagePrompt(RAW, { summary: "", recentTurns: "" });
    // RAW already contains all its own guard tokens, so nothing is appended.
    expect(out).toBe(RAW);
  });

  it("returns raw prompt when callLLM yields empty content", async () => {
    callLLMMock.mockResolvedValueOnce({ text: "   ", provider: "openrouter" });
    const out = await enrichImagePrompt(RAW);
    expect(out).toBe(RAW);
  });
});

describe("generateChatImage", () => {
  it("passes the enriched prompt (not raw userText) to the provider", async () => {
    // No conversation id: skip the DB history path entirely so this test is
    // purely about "enriched string reaches the provider".
    conversationFindUnique.mockResolvedValue(null);
    generateImageMock.mockResolvedValueOnce({
      buffer: Buffer.from("png"),
      provider: "stub",
      meta: { seed: 42 },
    });

    // Enrichment (via callLLM) must return a distinctive string so we can prove
    // the provider received THAT string and not the raw userText.
    const ENRICHED = "ENRICHED_PROMPT_MARKER_XYZ";
    callLLMMock.mockResolvedValueOnce({ text: ENRICHED, provider: "openrouter" });

    const USER_TEXT = "send me a photo of you in a garden";
    await generateChatImage(USER_TEXT);

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const args = generateImageMock.mock.calls[0][0];
    // The enriched marker reaches the provider (guard may append user tokens
    // like "garden", so assert containment rather than exact equality).
    expect(args.prompt).toContain(ENRICHED);
    expect(args.prompt).not.toBe(USER_TEXT);
    // Also assert the cleaned prompt (which would be the fallback) is not what
    // we sent, guarding against a regression where enrichment gets bypassed.
    expect(args.prompt).not.toContain("send me a photo");
  });
});
