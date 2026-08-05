// Image-decision heuristics. Same shape as voice/decision.ts.

const REQUEST_PATTERNS: RegExp[] = [
  /\b(send|show|share|give|take)\s+(me\s+)?(a\s+)?(pic|picture|photo|selfie|image|shot|snap)\b/i,
  /\b(what|how)\s+do\s+you\s+look\s+like\b/i,
  /\bcan\s+i\s+see\s+(you|it)\b/i,
  /\bshow\s+me\b/i,
];

export function isImageRequest(text: string): boolean {
  return REQUEST_PATTERNS.some((re) => re.test(text));
}

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
