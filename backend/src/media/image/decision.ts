// Image-delivery gating heuristics (token balance / recency limits).
//
// NOTE: image REQUEST detection used to live here as a regex keyword list
// (isImageRequest / REQUEST_PATTERNS). That has been replaced by the LLM intent
// classifier in chat/intent.ts (classifyMessageIntent). There is intentionally
// no keyword/regex request detection anywhere anymore.

export interface ImageDecisionContext {
  userRequested: boolean;
  tokenBalance: number;
  imageCost: number;
  recentImageCount: number;
  recentImageLimit: number;
}

export interface ImageDecision {
  send: boolean;
  reason: string;
}

export function shouldSendImage(ctx: ImageDecisionContext): ImageDecision {
  if (ctx.tokenBalance < ctx.imageCost) return { send: false, reason: "insufficient_tokens" };
  if (ctx.userRequested) return { send: true, reason: "user_requested" };
  if (ctx.recentImageCount >= ctx.recentImageLimit) return { send: false, reason: "recent_limit" };
  return { send: false, reason: "not_auto_enabled" };
}
