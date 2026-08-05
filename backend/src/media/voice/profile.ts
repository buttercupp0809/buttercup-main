// Resolve the effective voice profile for a character version. When a
// character has no VoiceProfile row (system characters, drafts), we fall
// back to the ElevenLabs default so the pipeline still produces audio.

import { prisma } from "@poppy/database";
import { DEFAULT_VOICE_IDS } from "./constants";

export interface EffectiveVoiceProfile {
  provider: "elevenlabs" | "cartesia" | "google" | "system";
  voiceId: string;
  params: Record<string, unknown>;
}

const SYSTEM_DEFAULT: EffectiveVoiceProfile = {
  provider: "elevenlabs",
  voiceId: DEFAULT_VOICE_IDS.elevenlabs,
  params: {},
};

export async function resolveVoiceProfile(characterVersionId: string): Promise<EffectiveVoiceProfile> {
  const version = await prisma.characterVersion.findUnique({
    where: { id: characterVersionId },
    include: { voiceProfile: true },
  });
  const vp = version?.voiceProfile;
  if (!vp || vp.provider === "system") return SYSTEM_DEFAULT;
  const provider = (["elevenlabs", "cartesia", "google"] as const).find((p) => p === vp.provider);
  if (!provider) return SYSTEM_DEFAULT;
  return {
    provider,
    voiceId: vp.voiceId,
    params: (vp.params as Record<string, unknown>) ?? {},
  };
}
