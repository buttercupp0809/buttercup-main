// Fast-pass crisis detector. Mirrors Pellow's tiered phrase-list model.
// Runs synchronously in the chat pipeline BEFORE generation; a positive
// hit triggers the SB 243 protocol path.
//
// LEVEL_3 = imminent risk. Pipeline is short-circuited; a pre-written
//           supportive response + crisis resources is sent directly.
// LEVEL_2 = serious ideation. Generation continues but is steered by a
//           promptOverride and resources are appended.
// LEVEL_1 = distress signals. Adds warmth to the persona prompt.

import { prisma } from "@poppy/database";

export type CrisisLevel = 0 | 1 | 2 | 3;

export interface CrisisResult {
  level: CrisisLevel;
  promptOverride: string | null;
  responseAppend: string | null;
  immediateResponse: string | null;
  flagMessage: string | null;
}

export const RESOURCES =
  "If you are in the US: call or text 988 (Suicide & Crisis Lifeline) or text HOME to 741741 (Crisis Text Line). If you are outside the US, please contact your local emergency number or visit https://findahelpline.com.";

export const LEVEL_3_PHRASES: RegExp[] = [
  /\b(i(?:'|\u2019)?m\s+going\s+to\s+kill\s+myself)\b/i,
  /\btonight\s+is\s+the\s+night\b/i,
  /\bready\s+to\s+end\s+it\b/i,
  /\b(i\s+have\s+(?:a\s+)?(?:gun|pills|rope|knife))\b/i,
  /\b(goodbye\s+forever|final\s+goodbye)\b/i,
];

export const LEVEL_2_PHRASES: RegExp[] = [
  /\bi\s+want\s+to\s+die\b/i,
  /\bwant\s+to\s+end\s+my\s+life\b/i,
  /\bcan(?:'|\u2019)?t\s+go\s+on\b/i,
  /\bthinking\s+about\s+killing\s+myself\b/i,
  /\bhurt\s+myself\b/i,
  /\bcut\s+myself\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
];

export const LEVEL_1_PHRASES: RegExp[] = [
  /\bi\s+feel\s+(?:so\s+)?(?:hopeless|worthless|empty)\b/i,
  /\bnobody\s+(?:cares|loves\s+me)\b/i,
  /\bi(?:'|\u2019)?m\s+(?:so\s+)?alone\b/i,
  /\btired\s+of\s+everything\b/i,
];

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function detectCrisisLevel(text: string): CrisisLevel {
  if (!text) return 0;
  if (matchAny(text, LEVEL_3_PHRASES)) return 3;
  if (matchAny(text, LEVEL_2_PHRASES)) return 2;
  if (matchAny(text, LEVEL_1_PHRASES)) return 1;
  return 0;
}

const L3_MESSAGE =
  "I'm really glad you told me. What you're feeling is serious and I want you to be safe right now. Please reach out to someone who can help immediately.";

const L2_STEER =
  "The user is expressing serious distress or suicidal ideation. Respond with warmth, validation, and gentle encouragement to talk to a trained human. Do not moralize. Do not roleplay past this beat. Keep it short.";

const L1_STEER =
  "The user is expressing loneliness or hopelessness. Respond with extra warmth, without minimizing. Ask a soft, open question that invites them to share more.";

export function getCrisisResult(level: CrisisLevel): CrisisResult {
  switch (level) {
    case 3:
      return {
        level: 3,
        promptOverride: null,
        responseAppend: null,
        immediateResponse: `${L3_MESSAGE}\n\n${RESOURCES}`,
        flagMessage: "l3_intervention",
      };
    case 2:
      return {
        level: 2,
        promptOverride: L2_STEER,
        responseAppend: `\n\n${RESOURCES}`,
        immediateResponse: null,
        flagMessage: "l2_steer",
      };
    case 1:
      return {
        level: 1,
        promptOverride: L1_STEER,
        responseAppend: null,
        immediateResponse: null,
        flagMessage: "l1_warmth",
      };
    default:
      return { level: 0, promptOverride: null, responseAppend: null, immediateResponse: null, flagMessage: null };
  }
}

// Fast entry point the pipeline calls.
export function checkCrisis(text: string): CrisisResult {
  return getCrisisResult(detectCrisisLevel(text));
}

// Fire-and-forget crisis log. Never throws; a logging failure must not
// swallow the intervention. Content is truncated to avoid storing large
// messages in the audit path.
export async function logCrisisEvent(
  userId: string,
  level: CrisisLevel,
  trigger: string,
  action: string,
): Promise<void> {
  try {
    await prisma.crisisEvent.create({
      data: {
        userId,
        level,
        trigger: trigger.slice(0, 2000),
        action,
      },
    });
  } catch {
    // deliberately swallowed
  }
}
