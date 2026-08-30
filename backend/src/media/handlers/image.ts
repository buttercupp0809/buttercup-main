// Image job handler. Loads the pinned CharacterVersion + AppearanceSheet,
// asserts adult subject, builds a deterministic prompt, and calls the
// provider chain. Reference images come from the AppearanceSheet key list
// via signed S3 URLs (IP-Adapter conditioning) or a LoRA ref when the
// character has trained weights.

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
import { resolveImageFlags } from "../image/flags";
import { resolveCharacterLora, resolveCheckpointForBaseModel } from "../lora/resolve";

export const imageHandler = async (job: MediaJobData): Promise<HandlerOutput> => {
  if (!job.characterId) throw new Error("image_missing_character");
  const characterId = job.characterId;

  const [character, loraLookup] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      include: {
        currentVersion: {
          include: { appearanceSheet: true },
        },
      },
    }),
    // Resolve the newest ready trained LoRA for this character (if any).
    resolveCharacterLora(characterId),
  ]);
  // row: a ready ROW existed (regardless of s3Key). Its existence alone overrides
  // the appearance sheet's loraRef/checkpoint for cloud providers.
  // resolution: derived generation inputs, present only when s3Key exists. Gates
  // ComfyUI LoRA-node activation.
  const { row: loraRow, resolution: loraResolution } = loraLookup;

  if (!character || !character.currentVersion?.appearanceSheet) {
    throw new Error("image_character_or_sheet_missing");
  }
  assertCharacterAdult(character);

  const userRequest =
    typeof job.payload.userRequest === "string" ? job.payload.userRequest : "";
  rejectMinorReference(userRequest);

  const sheet = character.currentVersion.appearanceSheet;
  const style = character.style === "threeD" ? "3d" : (character.style as "realistic" | "anime");

  // Inject the LoRA trigger token into the prompt when a ready LoRA ROW exists so
  // the identity token is active across all providers (matches pre-refactor
  // behavior: the token was injected whenever a ready row existed, independent of
  // s3Key or the IMG_LORA flag; cloud providers rely on it via loraRef).
  const triggerToken = loraRow?.triggerToken ?? null;

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

  // When a ready CharacterLora with usable weights exists AND the IMG_LORA
  // kill-switch is on, wire the LoRA into the ComfyUI basic workflow (loraName).
  // Without the flag (or without a usable s3Key) the basic path emits no LoRA
  // node (byte-identical to today). The checkpoint override and loraRef are
  // driven by the ROW existing, not by s3Key, so a ready row overrides the
  // sheet's checkpoint/loraRef exactly as before this refactor. Cloud providers
  // (fal/replicate) use loraRef regardless of the IMG_LORA flag.
  const loraFlag = resolveImageFlags().lora;
  const loraName = loraFlag && loraResolution ? loraResolution.loraName : undefined;
  const ckptOverride = loraRow ? resolveCheckpointForBaseModel(loraRow.baseModel) : undefined;

  const out = await generateImage({
    prompt,
    negativePrompt,
    style,
    referenceImageUrls,
    // Cloud providers still use the legacy loraRef from the appearance sheet.
    // When a CharacterLora row exists, it takes precedence (even with a null
    // s3Key, which yields loraRef: null and suppresses the sheet ref).
    loraRef: loraRow ? (loraRow.s3Key ?? null) : (sheet.loraRef ?? null),
    seed,
    loraName,
    ckptOverride,
  });

  const { buffer, contentType } = await toWebP(out.buffer);

  const conditioning = loraRow
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
      ...(loraName ? { loraName, loraBaseModel: loraRow?.baseModel } : {}),
      ...out.meta,
    },
  };
};

export { ImageSafetyError };
