// Image-decision heuristics. Same shape as voice/decision.ts.

const REQUEST_PATTERNS: RegExp[] = [
  // send / show / share / give / take + media noun
  /\b(send|show|share|give|take)\s+(me\s+)?(a\s+)?(pic|picture|photo|selfie|image|shot|snap)\b/i,
  // generate a pic/picture/image/photo
  /\bgenerate\s+(a\s+|an\s+)?(pic|picture|image|photo)\b/i,
  // make a pic/image/photo
  /\bmake\s+(a\s+|an\s+)?(pic|picture|image|photo)\b/i,
  // create a pic/image/photo
  /\bcreate\s+(a\s+|an\s+)?(pic|picture|image|photo)\b/i,
  // take a picture/photo/selfie
  /\btake\s+(a\s+|an\s+)?(picture|photo|selfie)\b/i,
  // post a photo/pic
  /\bpost\s+(a\s+|an\s+)?(photo|pic|picture|image)\b/i,
  // send pic / send photo (without "me")
  /\bsend\s+(a\s+)?(pic|photo|picture|image|selfie)\b/i,
  // can i see a pic/photo
  /\bcan\s+i\s+see\s+(a\s+|an\s+)?(pic|photo|picture|image|selfie)\b/i,
  // what/how do you look like
  /\b(what|how)\s+do\s+you\s+look\s+like\b/i,
  // can i see you / it
  /\bcan\s+i\s+see\s+(you|it)\b/i,
  // show me (standalone)
  /\bshow\s+me\b/i,
  // show yourself / show me yourself
  /\bshow\s+(me\s+)?yourself\b/i,
  // i want to see / let me see
  /\b(i\s+want\s+to\s+see|let\s+me\s+see)\b/i,
  // pic of you / photo of you / image of you / selfie (of you)
  /\b(pic|photo|picture|image|selfie)\s+of\s+you\b/i,
  // data image / data image generator pic (literal phrases from transcripts)
  /\bdata\s+image\b/i,
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
