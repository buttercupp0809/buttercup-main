// Image job handler. Loads the pinned CharacterVersion + AppearanceSheet,
// asserts adult subject, builds a deterministic prompt, and calls the
// provider chain. Reference images come from the AppearanceSheet key list
// via signed S3 URLs (IP-Adapter conditioning) or a LoRA ref when the
// character has trained weights.

import { prisma } from "@buttercupp/database";
import { expressionSchema, poseSchema, type Expression, type Pose } from "@buttercupp/shared";
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

// Parse an optional expression from the opaque job payload. Returns undefined
// when the field is absent or invalid (so the invariant holds: a payload
// without expression produces the same output as before).
function parseExpressionFromPayload(payload: Record<string, unknown>): Expression | undefined {
  if (!("expression" in payload)) return undefined;
  const result = expressionSchema.safeParse(payload.expression);
  return result.success ? result.data : undefined;
}

// Parse an optional pose from the opaque job payload. Same semantics as above.
function parsePoseFromPayload(payload: Record<string, unknown>): Pose | undefined {
  if (!("pose" in payload)) return undefined;
  const result = poseSchema.safeParse(payload.pose);
  return result.success ? result.data : undefined;
}

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

  // Read optional expression and pose from the opaque payload. These are
  // validated by their zod schemas inside the helpers; an absent or invalid
  // value returns undefined so the invariant holds: payloads without
  // expression/pose produce output identical to before this change.
  const expression = parseExpressionFromPayload(job.payload);
  const pose = parsePoseFromPayload(job.payload);

  const sheet = character.currentVersion.appearanceSheet;
  const style = character.style === "threeD" ? "3d" : (character.style as "realistic" | "anime");

  // IMG_LORA is the MASTER kill switch for the character-LoRA feature. A LoRA is
  // "active" only when the flag is on AND the ready row has usable weights
  // (loraResolution is present only when s3Key exists). When active, every LoRA
  // input flows (ComfyUI loraName + checkpoint override, cloud loraRef, trigger
  // token). When NOT active (flag off, or no usable weights) the feature is fully
  // inert and generation is byte-identical to the no-LoRA baseline on ALL
  // providers: no checkpoint swap, no LoRA node, no cloud loraRef override, and no
  // orphan trigger token that no provider can resolve. This closes the prior gap
  // where a ready row swapped the checkpoint + injected the token even with the
  // kill switch off, degrading the self-hosted (primary) ComfyUI path.
  const activeLora =
    resolveImageFlags().lora && loraResolution && loraRow
      ? { resolution: loraResolution, row: loraRow }
      : null;

  const triggerToken = activeLora ? activeLora.row.triggerToken : null;

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
    expression,
    pose,
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

  // All LoRA generation inputs key off `activeLora` (flag on + usable weights),
  // so the IMG_LORA kill switch is a true global off: when inactive, the ComfyUI
  // basic workflow gets no LoRA node and no checkpoint override, and cloud
  // providers fall back to the appearance sheet's loraRef (byte-identical
  // baseline). The checkpoint override only applies alongside the ComfyUI LoRA
  // node it is meant to match, never on its own.
  const loraName = activeLora ? activeLora.resolution.loraName : undefined;
  const ckptOverride = activeLora ? resolveCheckpointForBaseModel(activeLora.row.baseModel) : undefined;

  const out = await generateImage({
    prompt,
    negativePrompt,
    style,
    referenceImageUrls,
    // When the LoRA is active, cloud providers load it via the row's s3Key;
    // otherwise loraRef falls back to the appearance sheet (or null).
    loraRef: activeLora ? (activeLora.row.s3Key ?? null) : (sheet.loraRef ?? null),
    seed,
    loraName,
    ckptOverride,
  });

  const { buffer, contentType } = await toWebP(out.buffer);

  const conditioning = activeLora
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
