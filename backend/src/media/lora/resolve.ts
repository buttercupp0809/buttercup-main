// Shared LoRA resolution helper used by both the media-job image handler and
// the in-chat selfie path. Resolves the newest READY CharacterLora for a
// character, derives the checkpoint filename from the training base model, and
// returns the inputs the generation call needs. Both callers must still respect
// the IMG_LORA kill-switch (the helper does NOT check the flag).

import path from "node:path";
import { prisma } from "@buttercupp/database";

// Checkpoint filenames per base-model id. Values match the constants used in
// backend/src/media/handlers/image.ts. Both call sites use resolveCheckpointForBaseModel
// so the mapping is maintained in exactly one place.
const JUGGERNAUT_CHECKPOINT = "juggernautXL_v9.safetensors";
const REALVISXL_CHECKPOINT = "realvisxlV50.safetensors";

export function resolveCheckpointForBaseModel(baseModel: string): string {
  if (baseModel === "realvisxl_v5") return REALVISXL_CHECKPOINT;
  // juggernaut_xl_v9 and any unknown base model fall back to the box default.
  return JUGGERNAUT_CHECKPOINT;
}

// Derived generation inputs. Present only when the ready row has a usable s3Key
// (weights actually exist on the box). Absent (null) when the row exists but the
// weights key is missing, so generation activation stays gated on s3Key.
export interface CharacterLoraResolution {
  // Filename of the .safetensors LoRA on the ComfyUI box (e.g. "lora-abc.safetensors").
  loraName: string;
  // Token that activates the LoRA identity embedding; injected into the prompt.
  triggerToken: string | null;
  // Checkpoint override matching the LoRA training base model.
  ckptOverride: string;
  // Raw S3 key of the LoRA weights file. Used by cloud providers (fal/replicate)
  // as the loraRef argument; cloud providers accept the full S3 key, not just the
  // basename.
  s3Key: string;
  // Base model the LoRA was trained against. Surfaced in generation metadata.
  baseModel: string;
}

// The two facts callers need about a ready CharacterLora, kept distinct so the
// handler can preserve its exact pre-refactor behavior:
//   - row: the newest ready CharacterLora ROW (or null when none exists). Its
//     existence alone (regardless of s3Key) makes it OVERRIDE the appearance
//     sheet's loraRef/checkpoint for cloud providers.
//   - resolution: the derived generation inputs, or null when s3Key is missing.
//     Generation activation (loraName + lora flag + trigger injection) is gated
//     on this being non-null.
export interface CharacterLoraLookup {
  row: {
    s3Key: string | null;
    triggerToken: string | null;
    baseModel: string;
  } | null;
  resolution: CharacterLoraResolution | null;
}

// Resolve the newest ready CharacterLora for the given character. Never throws
// on a missing row; returns { row: null, resolution: null } when the character
// has no ready LoRA. When a ready row exists but its s3Key is missing, returns
// the row (so the handler can still override the sheet's loraRef/checkpoint) with
// resolution: null (so generation is not activated).
export async function resolveCharacterLora(
  characterId: string,
): Promise<CharacterLoraLookup> {
  const characterLora = await prisma.characterLora.findFirst({
    where: { characterId, status: "ready" },
    orderBy: { createdAt: "desc" },
  });

  if (!characterLora) return { row: null, resolution: null };

  const row = {
    s3Key: characterLora.s3Key ?? null,
    triggerToken: characterLora.triggerToken ?? null,
    baseModel: characterLora.baseModel,
  };

  if (!characterLora.s3Key) return { row, resolution: null };

  return {
    row,
    resolution: {
      loraName: path.basename(characterLora.s3Key),
      triggerToken: characterLora.triggerToken ?? null,
      ckptOverride: resolveCheckpointForBaseModel(characterLora.baseModel),
      s3Key: characterLora.s3Key,
      baseModel: characterLora.baseModel,
    },
  };
}
