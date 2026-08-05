// Voice job handler. Reads text + characterVersionId from the payload,
// resolves the effective voice profile, generates audio through the
// provider chain, and returns a buffer for the Phase-07 worker to upload
// to S3 + emit media.ready.

import type { MediaJobData } from "@buttercupp/shared";
import type { HandlerOutput } from "./index";
import { resolveVoiceProfile } from "../voice/profile";
import { generateVoiceNote } from "../voice/generate";

export const voiceHandler = async (job: MediaJobData): Promise<HandlerOutput> => {
  const text = typeof job.payload.text === "string" ? job.payload.text : "";
  const characterVersionId =
    typeof job.payload.characterVersionId === "string" ? job.payload.characterVersionId : "";
  if (!text) throw new Error("voice_missing_text");
  if (!characterVersionId) throw new Error("voice_missing_character_version");
  const profile = await resolveVoiceProfile(characterVersionId);
  const out = await generateVoiceNote(text, profile);
  return {
    buffer: out.audio,
    contentType: out.contentType,
    meta: { provider: out.provider, ttfaMs: out.ttfaMs },
  };
};
