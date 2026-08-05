// Voice-decision heuristics. Two entry points:
//   isVoiceRequest(text)     -> the user explicitly asked for audio
//   shouldSendAsVoice(ctx)   -> the system decides to deliver voice
//
// Poppy-specific gating: voice is a paid consumable, and we cap the recent
// per-(user, character) voice count so a chatty character does not burn
// the user's balance without consent.

const REQUEST_PATTERNS: RegExp[] = [
  /\bsay\s+it\s+out\s+loud\b/i,
  /\bvoice\s+(note|message|clip)\b/i,
  /\bcan\s+you\s+(talk|speak)\b/i,
  /\bhear\s+your\s+voice\b/i,
  /\bread\s+(that|it)\s+(to|for)\s+me\b/i,
];

export function isVoiceRequest(text: string): boolean {
  return REQUEST_PATTERNS.some((re) => re.test(text));
}

export interface VoiceDecisionContext {
  userRequested: boolean;
  tokenBalance: number;
  voiceCost: number;
  recentVoiceCount: number; // in the last N minutes for this (user, character)
  recentVoiceLimit: number;
  matureContent?: boolean;
}

export interface VoiceDecision {
  send: boolean;
  reason: string;
}

export function shouldSendAsVoice(ctx: VoiceDecisionContext): VoiceDecision {
  if (ctx.tokenBalance < ctx.voiceCost) return { send: false, reason: "insufficient_tokens" };
  // Fast path: user explicitly asked. Skip the recent-count throttle so a
  // requested clip always plays.
  if (ctx.userRequested) return { send: true, reason: "user_requested" };
  if (ctx.recentVoiceCount >= ctx.recentVoiceLimit) {
    return { send: false, reason: "recent_limit" };
  }
  // Currently we do not auto-send voice; the product default is
  // request-only until the recency + preference model in Phase 12 lands.
  return { send: false, reason: "not_auto_enabled" };
}
