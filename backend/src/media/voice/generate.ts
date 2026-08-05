// Voice generation chain. ElevenLabs streaming -> ElevenLabs batch ->
// Cartesia -> Google. Each provider has its own try/catch; a 401/403
// disables the provider for the process lifetime (Pellow pattern: no point
// retrying a bad key).
//
// Providers are called via raw fetch so the file compiles without vendor
// SDKs. Real integrations can be swapped in later without changing the
// chain shape.

import { truncateForVoice, convertToOggOpus } from "./audio";
import { ELEVENLABS_MODEL, ELEVENLABS_OUTPUT, TTFA_TARGET_MS } from "./constants";
import type { EffectiveVoiceProfile } from "./profile";

interface GenerateResult {
  audio: Buffer;
  provider: string;
  contentType: string;
  ttfaMs: number;
}

// Session-level disable flags. Reset only on process restart. Mirrors
// Pellow's `elevenLabsDisabled` etc.
const disabled = {
  elevenlabs: false,
  cartesia: false,
  google: false,
};

// Test-only: reset the disable flags between suites.
export function _resetDisabled(): void {
  disabled.elevenlabs = false;
  disabled.cartesia = false;
  disabled.google = false;
}

function isAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

async function generateWithElevenLabs(
  text: string,
  voiceId: string,
): Promise<GenerateResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("elevenlabs_not_configured");
  const start = performance.now();

  // Streaming WS path is a runtime optimization; if it fails we fall to
  // batch here so the caller sees only one ElevenLabs failure. Real WS
  // implementation would keep a warm pool per voiceId; the batch path is
  // the reliable fallback and is what this stub uses.
  //
  // TODO Phase 08 follow-up: real WS pre-warm pool. Skeleton lives in
  // elevenlabs-stream.ts so callers can iterate independently.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "content-type": "application/json",
      accept: "audio/ogg",
    },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.elevenlabs = true;
    throw new Error(`elevenlabs_${res.status}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return {
    audio,
    provider: "elevenlabs",
    contentType: "audio/ogg",
    ttfaMs: Math.round(performance.now() - start),
  };
}

async function generateWithCartesia(
  text: string,
  voiceId: string,
): Promise<GenerateResult> {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) throw new Error("cartesia_not_configured");
  const start = performance.now();
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "content-type": "application/json",
      "Cartesia-Version": "2024-06-10",
    },
    body: JSON.stringify({
      model_id: "sonic-english",
      transcript: text,
      voice: { mode: "id", id: voiceId },
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
    }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.cartesia = true;
    throw new Error(`cartesia_${res.status}`);
  }
  const wav = Buffer.from(await res.arrayBuffer());
  const ogg = await convertToOggOpus(wav, "wav");
  return {
    audio: ogg,
    provider: "cartesia",
    contentType: "audio/ogg",
    ttfaMs: Math.round(performance.now() - start),
  };
}

async function generateWithGoogle(
  text: string,
  voiceId: string,
): Promise<GenerateResult> {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error("google_not_configured");
  const start = performance.now();
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "en-US", name: voiceId },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.google = true;
    throw new Error(`google_${res.status}`);
  }
  const body = (await res.json()) as { audioContent?: string };
  if (!body.audioContent) throw new Error("google_no_audio");
  const mp3 = Buffer.from(body.audioContent, "base64");
  const ogg = await convertToOggOpus(mp3, "mp3");
  return {
    audio: ogg,
    provider: "google",
    contentType: "audio/ogg",
    ttfaMs: Math.round(performance.now() - start),
  };
}

export async function generateVoiceNote(
  text: string,
  profile: EffectiveVoiceProfile,
): Promise<GenerateResult> {
  const clean = truncateForVoice(text);
  const attempts: Array<() => Promise<GenerateResult>> = [];

  if (!disabled.elevenlabs) attempts.push(() => generateWithElevenLabs(clean, profile.voiceId));
  if (!disabled.cartesia) attempts.push(() => generateWithCartesia(clean, profile.voiceId));
  if (!disabled.google) attempts.push(() => generateWithGoogle(clean, profile.voiceId));

  let lastErr: unknown = new Error("no_voice_providers");
  for (const attempt of attempts) {
    try {
      const out = await attempt();
      if (out.ttfaMs > TTFA_TARGET_MS) {
        console.warn(`[voice] slow serve: ${out.provider} ttfa=${out.ttfaMs}ms`);
      }
      return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
