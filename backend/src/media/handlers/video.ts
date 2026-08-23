// Video job handler. Mirrors handlers/image.ts: loads the pinned
// CharacterVersion + AppearanceSheet, asserts an adult subject, builds a
// deterministic prompt, and calls the video provider chain.
//
// Dev behavior: when no video provider is configured (no API key + model slug
// in media/video/constants.ts), it returns a tiny placeholder clip so the
// full queue -> debit -> upload -> WS-notify pipeline still completes end to
// end. Set FAL_VIDEO_MODEL/REPLICATE_VIDEO_MODEL (+ keys) to switch to real
// generation with zero other changes.

import { prisma } from "@buttercupp/database";
import { createVideoPayloadSchema, type MediaJobData } from "@buttercupp/shared";
import type { HandlerOutput } from "./index";
import { buildVideoPrompt } from "../video/prompt";
import { generateVideo, videoProvidersConfigured } from "../video/providers";
import { videoSelfHostConfigured, type VideoAspect, type WanPreset } from "../video/constants";
import { assertCharacterAdult, rejectMinorReference } from "../image/safety";
import { resolveCharacterReferenceBytes } from "../reference";
import { restyleFirstFrame } from "../video/restyle";

// quality -> Wan sampling preset (identity today, but kept explicit so the wire
// enum and the internal preset names can drift independently later).
const QUALITY_TO_PRESET: Record<"fast" | "balanced" | "max", WanPreset> = {
  fast: "fast",
  balanced: "balanced",
  max: "max",
};

// aspectRatio -> Wan aspect key (identity, same rationale as above).
const ASPECT_MAP: Record<"portrait" | "landscape" | "square", VideoAspect> = {
  portrait: "portrait",
  landscape: "landscape",
  square: "square",
};

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

  // Validate the opaque MediaJobData.payload at the trust boundary. The generic
  // enqueue route passes payload straight through, so this is the first place
  // its shape is checked.
  const input = createVideoPayloadSchema.parse(job.payload);
  const userRequest = input.userRequest;
  rejectMinorReference(userRequest);

  const preset = QUALITY_TO_PRESET[input.quality];
  const aspect = ASPECT_MAP[input.aspectRatio];

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

  // Resolve the reference face bytes, optionally running Stage A (restyle) first.
  // sceneMode "transform": restyle a new first frame from the prompt so frame 0
  // already shows the requested outfit/scene. Falls back to the raw reference
  // when restyle returns null (box down, no ref image, etc.). sceneMode "keep":
  // animate the character's real photo without any scene change.
  let referenceBytes: Buffer | null;
  let restyle: "applied" | "failed" | "skipped";
  if (input.sceneMode === "transform") {
    referenceBytes = await restyleFirstFrame({ characterId: job.characterId, userRequest, aspect });
    if (referenceBytes) {
      restyle = "applied";
    } else {
      referenceBytes = await resolveCharacterReferenceBytes(job.characterId);
      restyle = "failed";
    }
  } else {
    referenceBytes = await resolveCharacterReferenceBytes(job.characterId);
    restyle = "skipped";
  }
  if (input.mode === "i2v" && !referenceBytes) {
    throw new Error("video_reference_unresolvable");
  }

  const seed =
    typeof job.payload.seed === "number"
      ? (job.payload.seed as number)
      : Math.floor(Math.random() * 1_000_000_000);
  const seconds = input.seconds;

  // Dev stub path: no provider wired at all (neither the self-hosted Wan box nor
  // a cloud provider). Return a placeholder so the pipeline completes; swap in
  // real output by configuring the Wan box or a cloud provider.
  if (!videoProvidersConfigured() && !videoSelfHostConfigured()) {
    return {
      buffer: STUB_CLIP,
      contentType: "video/mp4",
      meta: { provider: "stub", stub: true, prompt, negativePrompt, seed, sceneMode: input.sceneMode, restyle },
    };
  }

  const out = await generateVideo({
    mode: input.mode,
    prompt,
    negativePrompt,
    referenceImageUrls: [],
    referenceBytes: referenceBytes ?? undefined,
    seconds,
    aspect,
    preset,
    seed,
  });
  return {
    buffer: out.buffer,
    contentType: "video/webm",
    meta: {
      provider: out.provider,
      latencyMs: out.latencyMs,
      seed,
      conditioning: referenceBytes ? "i2v" : "none",
      sceneMode: input.sceneMode,
      restyle,
      ...out.meta,
    },
  };
};
