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

export const imageHandler = async (job: MediaJobData): Promise<HandlerOutput> => {
  if (!job.characterId) throw new Error("image_missing_character");
  const character = await prisma.character.findUnique({
    where: { id: job.characterId },
    include: {
      currentVersion: {
        include: { appearanceSheet: true },
      },
    },
  });
  if (!character || !character.currentVersion?.appearanceSheet) {
    throw new Error("image_character_or_sheet_missing");
  }
  assertCharacterAdult(character);

  const userRequest =
    typeof job.payload.userRequest === "string" ? job.payload.userRequest : "";
  rejectMinorReference(userRequest);

  const sheet = character.currentVersion.appearanceSheet;
  const style = character.style === "threeD" ? "3d" : (character.style as "realistic" | "anime");
  const { prompt, negativePrompt } = buildImagePrompt({
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

  const out = await generateImage({
    prompt,
    negativePrompt,
    style,
    referenceImageUrls,
    loraRef: sheet.loraRef ?? null,
    seed,
  });

  const { buffer, contentType } = await toWebP(out.buffer);

  return {
    buffer,
    contentType,
    meta: {
      provider: out.provider,
      latencyMs: out.latencyMs,
      seed,
      conditioning: sheet.loraRef ? "lora" : referenceImageUrls.length > 0 ? "ipadapter" : "none",
      ...out.meta,
    },
  };
};

export { ImageSafetyError };
