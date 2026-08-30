// Image job handler. Loads the pinned CharacterVersion + AppearanceSheet,
// asserts adult subject, builds a deterministic prompt, and calls the
// provider chain. Reference images come from the AppearanceSheet key list
// via signed S3 URLs (IP-Adapter conditioning) or a LoRA ref when the
// character has trained weights.

import path from "node:path";
import { prisma } from "@buttercupp/database";
import type { MediaJobData } from "@buttercupp/shared";
import type { HandlerOutput } from "./index";
import { buildImagePrompt } from "../image/prompt";
import { generateImage } from "../image/providers";
import { toWebP } from "../image/convert";
import {
  assertCharacterAdult,
  rejectMinorReference,
  ImageSafetyError,
} from "../image/safety";
import { getSignedUrl } from "../storage";
import { COMFY } from "../image/constants";

// Checkpoint filenames per base-model id. JUGGERNAUT_CHECKPOINT matches
// COMFY.checkpoint so both code paths stay in sync. REALVISXL_CHECKPOINT is
// a named constant because the file must be present on the box at inference
// time (deferred/infra task: upload realvisxlV50.safetensors to ComfyUI models/).
const JUGGERNAUT_CHECKPOINT = COMFY.checkpoint; // "juggernautXL_v9.safetensors"
const REALVISXL_CHECKPOINT = "realvisxlV50.safetensors";

function resolveCheckpointForBaseModel(baseModel: string): string {
  if (baseModel === "realvisxl_v5") return REALVISXL_CHECKPOINT;
  // juggernaut_xl_v9 and any unknown base model fall back to the box default.
  return JUGGERNAUT_CHECKPOINT;
}

export const imageHandler = async (job: MediaJobData): Promise<HandlerOutput> => {
  if (!job.characterId) throw new Error("image_missing_character");
  const characterId = job.characterId;

  const [character, characterLora] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      include: {
        currentVersion: {
          include: { appearanceSheet: true },
        },
      },
    }),
    // Resolve the newest ready trained LoRA for this character (if any).
    prisma.characterLora.findFirst({
      where: { characterId, status: "ready" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!character || !character.currentVersion?.appearanceSheet) {
    throw new Error("image_character_or_sheet_missing");
  }
  assertCharacterAdult(character);

  const userRequest =
    typeof job.payload.userRequest === "string" ? job.payload.userRequest : "";
  rejectMinorReference(userRequest);

  const sheet = character.currentVersion.appearanceSheet;
  const style = character.style === "threeD" ? "3d" : (character.style as "realistic" | "anime");

  // Inject the LoRA trigger token into the prompt when a ready LoRA exists so
  // the identity token is active across all providers.
  const triggerToken = characterLora?.triggerToken ?? null;

  const { prompt: basePrompt, negativePrompt } = buildImagePrompt({
    appearanceSheet: {
      stylePrompt: sheet.stylePrompt,
      negativePrompt: sheet.negativePrompt,
      traits: (sheet.traits as Record<string, unknown>) as {
        hair?: string;
        eye?: string;
        body?: string;
        features?: string[];
        clothing?: string;
      },
    },
    style,
    userRequest,
  });

  // Prepend trigger token to the positive prompt so all providers activate the
  // LoRA identity embedding. Prepend (not append) so CLIP weights it highly.
  const prompt = triggerToken ? `${triggerToken}, ${basePrompt}` : basePrompt;

  // Resolve reference image URLs for IP-Adapter conditioning. LoRA path is
  // preferred when the sheet has trained weights.
  const referenceImageUrls: string[] = [];
  for (const key of sheet.referenceImageKeys.slice(0, 3)) {
    try {
      referenceImageUrls.push(await getSignedUrl(key, 5 * 60));
    } catch {
      // A missing reference is not fatal; the base model can still render.
    }
  }

  const seed =
    typeof job.payload.seed === "number" ? (job.payload.seed as number) : Math.floor(Math.random() * 1_000_000_000);

  // When a ready CharacterLora exists, wire the LoRA into the ComfyUI basic
  // workflow (loraName) and override the checkpoint to match the training base
  // model. Cloud providers (fal/replicate) continue using loraRef.
  const loraName = characterLora?.s3Key ? path.basename(characterLora.s3Key) : undefined;
  const ckptOverride = characterLora ? resolveCheckpointForBaseModel(characterLora.baseModel) : undefined;

  const out = await generateImage({
    prompt,
    negativePrompt,
    style,
    referenceImageUrls,
    // Cloud providers still use the legacy loraRef from the appearance sheet.
    // When a CharacterLora exists, it takes precedence.
    loraRef: characterLora ? (characterLora.s3Key ?? null) : (sheet.loraRef ?? null),
    seed,
    loraName,
    ckptOverride,
  });

  const { buffer, contentType } = await toWebP(out.buffer);

  const conditioning = characterLora
    ? "character_lora"
    : sheet.loraRef
      ? "lora"
      : referenceImageUrls.length > 0
        ? "ipadapter"
        : "none";

  return {
    buffer,
    contentType,
    meta: {
      provider: out.provider,
      latencyMs: out.latencyMs,
      seed,
      conditioning,
      ...(loraName ? { loraName, loraBaseModel: characterLora?.baseModel } : {}),
      ...out.meta,
    },
  };
};

export { ImageSafetyError };
