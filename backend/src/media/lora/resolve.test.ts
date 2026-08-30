// Tests for the shared CharacterLora resolution helper. All Prisma calls are
// mocked so no live DB is required.

import { describe, it, expect, vi, beforeEach } from "vitest";

const characterLoraFindFirst = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterLora: { findFirst: characterLoraFindFirst },
  },
}));

const { resolveCharacterLora, resolveCheckpointForBaseModel } = await import("./resolve");

beforeEach(() => {
  characterLoraFindFirst.mockReset();
});

describe("resolveCheckpointForBaseModel", () => {
  it("returns realvisxl checkpoint for realvisxl_v5", () => {
    expect(resolveCheckpointForBaseModel("realvisxl_v5")).toBe("realvisxlV50.safetensors");
  });

  it("returns juggernaut checkpoint for juggernaut_xl_v9", () => {
    expect(resolveCheckpointForBaseModel("juggernaut_xl_v9")).toBe("juggernautXL_v9.safetensors");
  });

  it("falls back to juggernaut for unknown base models", () => {
    expect(resolveCheckpointForBaseModel("unknown_model")).toBe("juggernautXL_v9.safetensors");
  });
});

describe("resolveCharacterLora", () => {
  it("returns null when no ready LoRA exists", async () => {
    characterLoraFindFirst.mockResolvedValueOnce(null);
    const result = await resolveCharacterLora("char-1");
    expect(result).toBeNull();
    expect(characterLoraFindFirst).toHaveBeenCalledWith({
      where: { characterId: "char-1", status: "ready" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns null when LoRA exists but s3Key is missing", async () => {
    characterLoraFindFirst.mockResolvedValueOnce({
      id: "lora-1",
      characterId: "char-1",
      status: "ready",
      s3Key: null,
      triggerToken: "aria_v1",
      baseModel: "realvisxl_v5",
    });
    const result = await resolveCharacterLora("char-1");
    expect(result).toBeNull();
  });

  it("returns resolution with loraName as basename of s3Key", async () => {
    characterLoraFindFirst.mockResolvedValueOnce({
      id: "lora-2",
      characterId: "char-1",
      status: "ready",
      s3Key: "loras/characters/char-1/lora-abc123.safetensors",
      triggerToken: "aria_v1",
      baseModel: "realvisxl_v5",
    });
    const result = await resolveCharacterLora("char-1");
    expect(result).not.toBeNull();
    expect(result!.loraName).toBe("lora-abc123.safetensors");
    expect(result!.triggerToken).toBe("aria_v1");
    expect(result!.ckptOverride).toBe("realvisxlV50.safetensors");
    expect(result!.s3Key).toBe("loras/characters/char-1/lora-abc123.safetensors");
    expect(result!.baseModel).toBe("realvisxl_v5");
  });

  it("sets triggerToken to null when the DB field is null", async () => {
    characterLoraFindFirst.mockResolvedValueOnce({
      id: "lora-3",
      characterId: "char-1",
      status: "ready",
      s3Key: "loras/lora-no-token.safetensors",
      triggerToken: null,
      baseModel: "juggernaut_xl_v9",
    });
    const result = await resolveCharacterLora("char-1");
    expect(result!.triggerToken).toBeNull();
    expect(result!.ckptOverride).toBe("juggernautXL_v9.safetensors");
  });

  it("queries the newest (desc by createdAt) ready LoRA", async () => {
    characterLoraFindFirst.mockResolvedValueOnce(null);
    await resolveCharacterLora("char-99");
    const call = characterLoraFindFirst.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: "desc" });
    expect(call.where.status).toBe("ready");
  });
});
