// Tests for the image handler's CharacterLora wiring and expression/pose threading.
// Contract (Blocker 3 fix): IMG_LORA is the MASTER kill switch for the whole
// character-LoRA feature. A LoRA is "active" only when the flag is on AND a ready
// row with usable weights (s3Key) exists. When active, all LoRA inputs flow
// (ComfyUI loraName + checkpoint override; cloud loraRef; trigger token). When
// NOT active (flag off, or no usable weights) the feature is fully inert and
// generation is byte-identical to the no-LoRA baseline on EVERY provider: no
// checkpoint swap, no LoRA node, no cloud loraRef override, no orphan trigger
// token; loraRef falls back to the appearance sheet.
//
// Also verifies: expression/pose from job payload are threaded into buildImagePrompt;
// when absent, buildImagePrompt is called with expression/pose undefined (invariant).
//
// All heavy collaborators (Prisma, providers, WebP, S3, safety, flags) are
// mocked so no live DB / GPU / S3 is required.

import { describe, it, expect, vi, beforeEach } from "vitest";

const characterFindUnique = vi.fn();
const characterLoraFindFirst = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: { findUnique: characterFindUnique },
    characterLora: { findFirst: characterLoraFindFirst },
  },
}));

const generateImageMock = vi.fn();
vi.mock("../image/providers", () => ({
  generateImage: generateImageMock,
}));

vi.mock("../image/convert", () => ({
  toWebP: vi.fn().mockResolvedValue({ buffer: Buffer.from("webp"), contentType: "image/webp" }),
}));

vi.mock("../image/safety", () => ({
  assertCharacterAdult: vi.fn(),
  rejectMinorReference: vi.fn(),
  ImageSafetyError: class ImageSafetyError extends Error {},
}));

vi.mock("../storage", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/ref.png"),
}));

// buildImagePrompt: return a deterministic base prompt so trigger-token prepend
// is observable. The mock is captured so expression/pose threading tests can
// inspect the args passed to it.
const buildImagePromptMock = vi.fn(() => ({ prompt: "BASE_PROMPT", negativePrompt: "NEG" }));
vi.mock("../image/prompt", () => ({
  buildImagePrompt: (...a: unknown[]) => buildImagePromptMock(...a),
}));

// IMG_LORA flag: default off; individual tests override.
const resolveImageFlagsMock = vi.fn();
vi.mock("../image/flags", () => ({
  resolveImageFlags: (...a: unknown[]) => resolveImageFlagsMock(...a),
}));

const { imageHandler } = await import("./image");
import type { MediaJobData } from "@buttercupp/shared";

const mockSheet = {
  stylePrompt: "realistic woman",
  negativePrompt: "bad quality",
  traits: { hair: "brown", eye: "blue" },
  referenceImageKeys: [] as string[],
  loraRef: "sheet-lora-ref.safetensors",
};

const mockCharacter = {
  id: "char-1",
  style: "realistic",
  isAdult: true,
  currentVersion: {
    id: "ver-1",
    appearanceSheet: mockSheet,
  },
};

function makeJob(): MediaJobData {
  return {
    characterId: "char-1",
    userId: "user-1",
    jobId: "job-1",
    mediaType: "image",
    payload: { userRequest: "on a beach", seed: 123 },
  } as unknown as MediaJobData;
}

beforeEach(() => {
  characterFindUnique.mockReset().mockResolvedValue(mockCharacter);
  characterLoraFindFirst.mockReset().mockResolvedValue(null);
  generateImageMock.mockReset().mockResolvedValue({
    buffer: Buffer.from("png"),
    provider: "comfyui",
    latencyMs: 10,
    meta: {},
  });
  resolveImageFlagsMock.mockReset().mockReturnValue({ lora: false });
  buildImagePromptMock.mockReset().mockReturnValue({ prompt: "BASE_PROMPT", negativePrompt: "NEG" });
});

describe("imageHandler CharacterLora wiring", () => {
  it("ready row with null s3Key: LoRA not usable => byte-identical baseline (no ckpt/token, sheet.loraRef)", async () => {
    // A ready row exists but has no weights yet (no s3Key). With no usable LoRA
    // the feature must be fully inert: no checkpoint swap and no orphan trigger
    // token that no provider can actually resolve.
    characterLoraFindFirst.mockResolvedValue({
      id: "lora-1",
      characterId: "char-1",
      status: "ready",
      s3Key: null,
      triggerToken: "aria_v1",
      baseModel: "realvisxl_v5",
    });
    // Even with IMG_LORA on, no s3Key => no usable LoRA => baseline.
    resolveImageFlagsMock.mockReturnValue({ lora: true });

    const out = await imageHandler(makeJob());

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const args = generateImageMock.mock.calls[0][0];

    // No usable LoRA => loraRef falls back to the appearance sheet (baseline).
    expect(args.loraRef).toBe("sheet-lora-ref.safetensors");
    // No checkpoint override without a LoRA to match it (would degrade output).
    expect(args.ckptOverride).toBeUndefined();
    // No generation activation without weights.
    expect(args.loraName).toBeUndefined();
    // No orphan trigger token in the prompt.
    expect(args.prompt).toBe("BASE_PROMPT");
    // conditioning reflects the sheet loraRef, not an inactive character LoRA.
    expect(out.meta.conditioning).toBe("lora");
    expect(out.meta.loraName).toBeUndefined();
  });

  it("normal ready row (with s3Key) + IMG_LORA on: loraName set, ckpt + loraRef from row, trigger injected", async () => {
    characterLoraFindFirst.mockResolvedValue({
      id: "lora-2",
      characterId: "char-1",
      status: "ready",
      s3Key: "loras/chars/char-1/lora-abc.safetensors",
      triggerToken: "aria_v1",
      baseModel: "realvisxl_v5",
    });
    resolveImageFlagsMock.mockReturnValue({ lora: true });

    const out = await imageHandler(makeJob());

    const args = generateImageMock.mock.calls[0][0];
    expect(args.loraRef).toBe("loras/chars/char-1/lora-abc.safetensors");
    expect(args.ckptOverride).toBe("realvisxlV50.safetensors");
    expect(args.loraName).toBe("lora-abc.safetensors");
    expect(args.prompt).toBe("aria_v1, BASE_PROMPT");
    expect(out.meta.conditioning).toBe("character_lora");
    expect(out.meta.loraName).toBe("lora-abc.safetensors");
    expect(out.meta.loraBaseModel).toBe("realvisxl_v5");
  });

  it("ready row (with s3Key) + IMG_LORA off: master kill switch => baseline on ALL providers", async () => {
    // Blocker 3 fix: IMG_LORA is the master switch. When off, the character-LoRA
    // feature is fully inert everywhere (self-hosted AND cloud) so generation is
    // byte-identical to the no-LoRA baseline: no checkpoint swap, no ComfyUI LoRA
    // node, no cloud loraRef, no orphan trigger token.
    characterLoraFindFirst.mockResolvedValue({
      id: "lora-3",
      characterId: "char-1",
      status: "ready",
      s3Key: "loras/chars/char-1/lora-abc.safetensors",
      triggerToken: "aria_v1",
      baseModel: "juggernaut_xl_v9",
    });
    resolveImageFlagsMock.mockReturnValue({ lora: false });

    const out = await imageHandler(makeJob());

    const args = generateImageMock.mock.calls[0][0];
    // Flag off => cloud LoRA also suppressed; loraRef falls back to the sheet.
    expect(args.loraRef).toBe("sheet-lora-ref.safetensors");
    // No checkpoint override on the self-hosted path (no LoRA to match).
    expect(args.ckptOverride).toBeUndefined();
    // ComfyUI LoRA node not activated when flag is off.
    expect(args.loraName).toBeUndefined();
    // No orphan trigger token.
    expect(args.prompt).toBe("BASE_PROMPT");
    // conditioning reflects the sheet, not an inactive character LoRA.
    expect(out.meta.conditioning).toBe("lora");
  });

  it("no ready row: falls through to sheet.loraRef, no ckptOverride, sheet conditioning", async () => {
    characterLoraFindFirst.mockResolvedValue(null);
    resolveImageFlagsMock.mockReturnValue({ lora: true });

    const out = await imageHandler(makeJob());

    const args = generateImageMock.mock.calls[0][0];
    // No row => sheet's loraRef is used.
    expect(args.loraRef).toBe("sheet-lora-ref.safetensors");
    // No row => no checkpoint override.
    expect(args.ckptOverride).toBeUndefined();
    expect(args.loraName).toBeUndefined();
    // No trigger token prepend (no ready row).
    expect(args.prompt).toBe("BASE_PROMPT");
    // conditioning reflects the sheet loraRef.
    expect(out.meta.conditioning).toBe("lora");
  });
});

describe("imageHandler expression/pose threading", () => {
  it("invariant: payload WITHOUT expression/pose calls buildImagePrompt with both undefined", async () => {
    await imageHandler(makeJob());

    expect(buildImagePromptMock).toHaveBeenCalledTimes(1);
    const promptInput = buildImagePromptMock.mock.calls[0][0];
    expect(promptInput.expression).toBeUndefined();
    expect(promptInput.pose).toBeUndefined();
  });

  it("threads expression from payload into buildImagePrompt", async () => {
    const job = {
      ...makeJob(),
      payload: { userRequest: "on a beach", seed: 123, expression: "smiling" },
    } as unknown as import("@buttercupp/shared").MediaJobData;

    await imageHandler(job);

    const promptInput = buildImagePromptMock.mock.calls[0][0];
    expect(promptInput.expression).toBe("smiling");
    expect(promptInput.pose).toBeUndefined();
  });

  it("threads pose from payload into buildImagePrompt", async () => {
    const job = {
      ...makeJob(),
      payload: { userRequest: "on a beach", seed: 123, pose: "sitting" },
    } as unknown as import("@buttercupp/shared").MediaJobData;

    await imageHandler(job);

    const promptInput = buildImagePromptMock.mock.calls[0][0];
    expect(promptInput.pose).toBe("sitting");
    expect(promptInput.expression).toBeUndefined();
  });

  it("threads both expression and pose from payload into buildImagePrompt", async () => {
    const job = {
      ...makeJob(),
      payload: { userRequest: "on a beach", seed: 123, expression: "seductive", pose: "lying" },
    } as unknown as import("@buttercupp/shared").MediaJobData;

    await imageHandler(job);

    const promptInput = buildImagePromptMock.mock.calls[0][0];
    expect(promptInput.expression).toBe("seductive");
    expect(promptInput.pose).toBe("lying");
  });

  it("ignores an invalid expression value (parse helper returns undefined, invariant holds)", async () => {
    const job = {
      ...makeJob(),
      payload: { userRequest: "on a beach", seed: 123, expression: "not-valid-expression" },
    } as unknown as import("@buttercupp/shared").MediaJobData;

    await imageHandler(job);

    const promptInput = buildImagePromptMock.mock.calls[0][0];
    // Invalid value is silently dropped; undefined is passed so output is
    // identical to a payload without expression.
    expect(promptInput.expression).toBeUndefined();
  });

  it("ignores an invalid pose value (parse helper returns undefined, invariant holds)", async () => {
    const job = {
      ...makeJob(),
      payload: { userRequest: "on a beach", seed: 123, pose: "standing-on-one-foot" },
    } as unknown as import("@buttercupp/shared").MediaJobData;

    await imageHandler(job);

    const promptInput = buildImagePromptMock.mock.calls[0][0];
    expect(promptInput.pose).toBeUndefined();
  });
});
