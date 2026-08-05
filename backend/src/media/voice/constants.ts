// Voice pipeline constants. MEDIA_TOKEN_COSTS.voice already covers the
// ledger side (defined in @poppy/shared/media). This module owns per-provider
// model + output selection so a swap does not touch generate.ts.

export const MAX_VOICE_WORDS = 250;

// ElevenLabs Flash v2.5 is the current low-latency chat model. Opus 48k/64k
// keeps the payload small while retaining prosody.
export const ELEVENLABS_MODEL = "eleven_flash_v2_5";
export const ELEVENLABS_OUTPUT = "opus_48000_64";

// Fallback voice IDs, used when a VoiceProfile row is missing or when a
// system character has no owner-selected voice. Kept per-provider so
// resolveVoiceProfile can pick the matching default.
export const DEFAULT_VOICE_IDS = {
  elevenlabs: "warm-alto",
  cartesia: "aa0abbd7-6c8f-4d43-9cf9-3f8f4c7b1e94",
  google: "en-US-Neural2-F",
} as const;

// Cap voice audio-generation TTFA target. Logged from the worker; anything
// higher than this counts as a slow serve in metrics.
export const TTFA_TARGET_MS = 1500;
