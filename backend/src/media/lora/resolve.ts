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

// Resolve the newest ready CharacterLora for the given character. Returns null
// when no READY LoRA exists (character has no trained weights) or when the
// s3Key is missing (incomplete record). The caller decides whether to activate
// the LoRA based on the IMG_LORA flag.
export async function resolveCharacterLora(
  characterId: string,
): Promise<CharacterLoraResolution | null> {
  const characterLora = await prisma.characterLora.findFirst({
    where: { characterId, status: "ready" },
    orderBy: { createdAt: "desc" },
  });

  if (!characterLora?.s3Key) return null;

  return {
    loraName: path.basename(characterLora.s3Key),
    triggerToken: characterLora.triggerToken ?? null,
    ckptOverride: resolveCheckpointForBaseModel(characterLora.baseModel),
    s3Key: characterLora.s3Key,
    baseModel: characterLora.baseModel,
  };
}
