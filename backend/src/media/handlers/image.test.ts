// Tests for the image handler's CharacterLora wiring. Focus: the edge case
// where a ready CharacterLora row exists but its s3Key is null. Behavior must be
// a TRUE no-op vs the pre-refactor code:
//   - a ready ROW existing (regardless of s3Key) overrides the sheet's loraRef
//     and checkpoint (loraRef = row.s3Key ?? null, ckpt = from row.baseModel)
//   - generation activation (loraName + IMG_LORA lora flag) stays gated on s3Key
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
// is observable.
vi.mock("../image/prompt", () => ({
  buildImagePrompt: vi.fn(() => ({ prompt: "BASE_PROMPT", negativePrompt: "NEG" })),
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
});

describe("imageHandler CharacterLora wiring", () => {
  it("ready row with null s3Key: loraRef=null (NOT sheet.loraRef), ckpt from row, NO loraName/flag", async () => {
    // A ready row exists but has no weights yet.
    characterLoraFindFirst.mockResolvedValue({
      id: "lora-1",
      characterId: "char-1",
      status: "ready",
      s3Key: null,
      triggerToken: "aria_v1",
      baseModel: "realvisxl_v5",
    });
    // Even with IMG_LORA on, no s3Key => no LoRA node.
    resolveImageFlagsMock.mockReturnValue({ lora: true });

    const out = await imageHandler(makeJob());

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const args = generateImageMock.mock.calls[0][0];

    // Row existence overrides the sheet: loraRef is null (row.s3Key ?? null),
    // NOT the sheet's loraRef. This is the pre-refactor behavior being preserved.
    expect(args.loraRef).toBeNull();
    // Checkpoint override is derived from the ready row's base model.
    expect(args.ckptOverride).toBe("realvisxlV50.safetensors");
    // No generation activation without weights.
    expect(args.loraName).toBeUndefined();
    // Trigger token is still injected into the prompt when a ready row exists
    // (matches pre-refactor: token injected regardless of s3Key/flag).
    expect(args.prompt).toBe("aria_v1, BASE_PROMPT");
    // conditioning reflects the ready row.
    expect(out.meta.conditioning).toBe("character_lora");
    // No loraName in meta (activation did not happen).
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

  it("normal ready row (with s3Key) + IMG_LORA off: loraName omitted, loraRef + ckpt still from row", async () => {
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
    // Cloud providers still use loraRef regardless of the flag.
    expect(args.loraRef).toBe("loras/chars/char-1/lora-abc.safetensors");
    expect(args.ckptOverride).toBe("juggernautXL_v9.safetensors");
    // ComfyUI LoRA node not activated when flag is off.
    expect(args.loraName).toBeUndefined();
    expect(out.meta.conditioning).toBe("character_lora");
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
