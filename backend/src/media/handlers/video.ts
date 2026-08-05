// Video job handler. Mirrors handlers/image.ts: loads the pinned
// CharacterVersion + AppearanceSheet, asserts an adult subject, builds a
// deterministic prompt, and calls the video provider chain.
//
// Dev behavior: when no video provider is configured (no API key + model slug
// in media/video/constants.ts), it returns a tiny placeholder clip so the
// full queue -> debit -> upload -> WS-notify pipeline still completes end to
// end. Set FAL_VIDEO_MODEL/REPLICATE_VIDEO_MODEL (+ keys) to switch to real
// generation with zero other changes.

import { prisma } from "@poppy/database";
import type { MediaJobData } from "@poppy/shared";
import type { HandlerOutput } from "./index";
import { buildVideoPrompt } from "../video/prompt";
import { generateVideo, videoProvidersConfigured } from "../video/providers";
import { assertCharacterAdult, rejectMinorReference } from "../image/safety";
import { getSignedUrl } from "../storage";

// A 1KB placeholder used only when no provider is configured (dev). Not a
// playable clip; it just exercises the binary upload + notify path.
const STUB_CLIP = Buffer.alloc(1024, 0);

export const videoHandler = async (job: MediaJobData): Promise<HandlerOutput> => {
  if (!job.characterId) throw new Error("video_missing_character");
  const character = await prisma.character.findUnique({
    where: { id: job.characterId },
    include: { currentVersion: { include: { appearanceSheet: true } } },
  });
  if (!character || !character.currentVersion?.appearanceSheet) {
    throw new Error("video_character_or_sheet_missing");
  }
  assertCharacterAdult(character);

  const userRequest =
    typeof job.payload.userRequest === "string" ? job.payload.userRequest : "";
  rejectMinorReference(userRequest);

  const sheet = character.currentVersion.appearanceSheet;
  const style = character.style === "threeD" ? "3d" : (character.style as "realistic" | "anime");
  const { prompt, negativePrompt } = buildVideoPrompt({
    appearanceSheet: {
      stylePrompt: sheet.stylePrompt,
      negativePrompt: sheet.negativePrompt,
      traits: sheet.traits as {
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

  const referenceImageUrls: string[] = [];
  for (const key of sheet.referenceImageKeys.slice(0, 3)) {
    try {
      referenceImageUrls.push(await getSignedUrl(key, 5 * 60));
    } catch {
      // Missing reference is not fatal.
    }
  }

  const seed =
    typeof job.payload.seed === "number"
      ? (job.payload.seed as number)
      : Math.floor(Math.random() * 1_000_000_000);
  const seconds = typeof job.payload.seconds === "number" ? (job.payload.seconds as number) : undefined;

  // Dev stub path: no provider wired yet. Return a placeholder so the pipeline
  // completes; swap in real output by configuring a provider.
  if (!videoProvidersConfigured()) {
    return {
      buffer: STUB_CLIP,
      contentType: "video/mp4",
      meta: { provider: "stub", stub: true, prompt, negativePrompt, seed },
    };
  }

  const out = await generateVideo({ prompt, negativePrompt, referenceImageUrls, seed, seconds });
  return {
    buffer: out.buffer,
    contentType: "video/mp4",
    meta: {
      provider: out.provider,
      latencyMs: out.latencyMs,
      seed,
      conditioning: referenceImageUrls.length > 0 ? "ipadapter" : "none",
      ...out.meta,
    },
  };
};
