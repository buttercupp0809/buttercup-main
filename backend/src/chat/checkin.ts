// Active check-in: when a user opens a chat we may proactively drop one
// in-character assistant message so the conversation never sits empty and so
// long-idle conversations get re-opened warmly. Eligibility is strict: fire
// on a brand new conversation OR after CHECKIN_GAP_MS of silence when the
// last message came from the user (so we never stack two assistant messages
// in a row). Generation is live via the same provider chain as regular chat;
// on any failure we fall back to the character's static greeting so the chat
// is never blank.
//
// Persistence is atomic: create Message + bump Conversation counters in one
// transaction. Idempotency is enforced inside the transaction by re-checking
// the latest message just before the create, so two near-simultaneous calls
// (double open of the same chat) cannot both write a check-in.

import { prisma } from "@buttercupp/database";
import type { ContentRating } from "@buttercupp/database";
import { buildPromptLayers } from "../llm/prompts";
import { callLLM } from "../llm/provider";
import { logInfo, logWarn } from "../utils/log";

// 24h idle threshold. Environment override kept for tests and local tuning.
export const CHECKIN_GAP_MS = (() => {
  const raw = process.env.POPPY_CHECKIN_GAP_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 24 * 60 * 60 * 1000;
})();

export interface MaybeRunCheckinInput {
  conversationId: string;
  userId: string;
}

export interface MaybeRunCheckinResult {
  created: boolean;
  message?: {
    id: string;
    role: "assistant";
    content: string;
    createdAt: string;
  };
}

interface Preferences {
  vibe?: unknown;
  interests?: unknown;
  companionGoal?: unknown;
}

interface PersonalizationCtx {
  name: string;
  vibe: string | null;
  interests: string[];
  companionGoal: string | null;
}

function resolveName(displayName: string | null | undefined, email: string): string {
  const dn = (displayName ?? "").trim();
  if (dn) return dn;
  const local = email.split("@")[0] ?? "";
  return local.trim() || "there";
}

function readPrefs(raw: unknown): {
  vibe: string | null;
  interests: string[];
  companionGoal: string | null;
} {
  const out = { vibe: null as string | null, interests: [] as string[], companionGoal: null as string | null };
  if (!raw || typeof raw !== "object") return out;
  const p = raw as Preferences;
  if (typeof p.vibe === "string" && p.vibe.trim()) out.vibe = p.vibe.trim();
  if (Array.isArray(p.interests)) {
    out.interests = p.interests.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (typeof p.companionGoal === "string" && p.companionGoal.trim()) {
    out.companionGoal = p.companionGoal.trim();
  }
  return out;
}

function personalizeGreeting(name: string, greeting: string): string {
  const g = (greeting ?? "").trim();
  if (!g) return `Hey ${name}.`;
  // If the greeting already starts with the user's name, leave it alone.
  const lower = g.toLowerCase();
  if (lower.startsWith(name.toLowerCase())) return g;
  return `Hey ${name}, ${g[0]?.toLowerCase() ?? ""}${g.slice(1)}`;
}

export type CheckinMode = "first_open" | "reopen_after_gap";

// Instruction copy is split by mode so first-open messages never sound like
// "welcome back". first_open is a cold introduction; reopen_after_gap is a
// warm reconnect after >= CHECKIN_GAP_MS of silence.
const FIRST_OPEN_INSTRUCTION =
  "This is your very first message to this user. You have never spoken before, so do NOT imply any prior interaction, memory, or history. Introduce yourself in character: 2 to 3 short lines with action beats in asterisks, greet them warmly by name, and when it feels natural weave in ONE of their stated interests or goals. Ask at most one light, open question. Do not reference past conversations, shared memories, or prior meetings in any form. Never mention being an AI.";

const REOPEN_INSTRUCTION =
  "You are reaching out to reconnect after time apart, picking up the thread of your ongoing connection. Send ONE warm, in-character opening (2 to 3 short lines, action beats in asterisks) that references the user by name and, when natural, one of their stated interests or goals. Do not ask more than one question. Never mention being an AI.";

function buildCheckinInstruction(mode: CheckinMode, ctx: PersonalizationCtx): string {
  const bits: string[] = [];
  bits.push(`The user's name is ${ctx.name}.`);
  if (ctx.vibe) bits.push(`Vibe they picked: ${ctx.vibe}.`);
  if (ctx.interests.length > 0) bits.push(`Stated interests: ${ctx.interests.slice(0, 5).join(", ")}.`);
  if (ctx.companionGoal) bits.push(`What they want from a companion: ${ctx.companionGoal}.`);
  bits.push(mode === "first_open" ? FIRST_OPEN_INSTRUCTION : REOPEN_INSTRUCTION);
  return bits.join(" ");
}

export interface CheckinPersonaInput {
  name: string;
  personality: string;
  backstory: string;
  behavioralInstructions: string;
  contentRating: ContentRating;
}

export function buildCheckinSystemPrompt(
  mode: CheckinMode,
  persona: CheckinPersonaInput,
  personalization: PersonalizationCtx,
): string {
  const personaSystem = buildPromptLayers({
    characterVersion: {
      name: persona.name,
      personality: persona.personality,
      backstory: persona.backstory,
      behavioralInstructions: persona.behavioralInstructions,
    },
    contentRating: persona.contentRating,
    relationshipState: null,
    injectedMemory: null,
    userAge: null,
  });
  const heading = mode === "first_open" ? "# Check-in (first open)" : "# Check-in (reopen after gap)";
  return `${personaSystem}\n\n${heading}\n${buildCheckinInstruction(mode, personalization)}`;
}

export async function maybeRunCheckin(
  input: MaybeRunCheckinInput,
): Promise<MaybeRunCheckinResult> {
  const { conversationId, userId } = input;

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      character: true,
      characterVersion: true,
    },
  });
  if (!conv) {
    logWarn("checkin", `conversation not found or not owned conv=${conversationId}`, { userId });
    return { created: false };
  }

  const [user, profile, latest] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!user) {
    logWarn("checkin", `user not found user=${userId}`);
    return { created: false };
  }

  // Eligibility. See file header for the full rule.
  const now = Date.now();
  let mode: CheckinMode = "first_open";
  if (latest) {
    if (latest.role === "assistant") return { created: false };
    if (latest.role !== "user") return { created: false };
    const ageMs = now - latest.createdAt.getTime();
    if (ageMs < CHECKIN_GAP_MS) return { created: false };
    mode = "reopen_after_gap";
  }

  const name = resolveName(profile?.displayName, user.email);
  const prefs = readPrefs(profile?.preferences);
  const personalization: PersonalizationCtx = {
    name,
    vibe: prefs.vibe,
    interests: prefs.interests,
    companionGoal: prefs.companionGoal,
  };

  const systemPrompt = buildCheckinSystemPrompt(
    mode,
    {
      name: conv.character.name,
      personality: conv.characterVersion.personality,
      backstory: conv.characterVersion.backstory,
      behavioralInstructions: conv.characterVersion.behavioralInstructions,
      contentRating: conv.character.contentRating,
    },
    personalization,
  );

  let content = "";
  try {
    const result = await callLLM({
      purpose: "chat",
      systemPrompt,
      messages: [
        {
          role: "user",
          content:
            mode === "first_open"
              ? "(silent open: the user just opened this chat for the very first time. Introduce yourself in character now.)"
              : "(silent open: the user just reopened the chat after time away. Send your in-character check-in now.)",
        },
      ],
      maxTokens: 120,
      temperature: 0.8,
      contentRating: conv.character.contentRating,
      tier: user.subscriptionTier,
      jurisdiction: user.jurisdiction,
    });
    content = (result.text ?? "").trim();
    if (result.provider === "hardcoded") {
      // Hardcoded means the whole chain was unavailable; treat as fallback.
      content = "";
    }
  } catch (err) {
    logWarn("checkin", `LLM failed, using greeting fallback: ${err instanceof Error ? err.message : String(err)}`, {
      conversationId,
    });
    content = "";
  }
  if (!content) {
    content = personalizeGreeting(name, conv.characterVersion.greeting);
  }

  // Atomic write plus idempotency re-check. Anything that would make this
  // call ineligible now (a concurrent second open just wrote its own
  // assistant check-in, or the user sent a message inside the gap window)
  // aborts the write cleanly with created: false.
  const persisted = await prisma.$transaction(async (tx) => {
    const latestNow = await tx.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });
    if (latestNow) {
      if (latestNow.role === "assistant") return null;
      if (latestNow.role === "user") {
        const ageMs = Date.now() - latestNow.createdAt.getTime();
        if (ageMs < CHECKIN_GAP_MS) return null;
      }
    }
    const msg = await tx.message.create({
      data: {
        conversationId,
        role: "assistant",
        content,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
      },
    });
    return msg;
  });

  if (!persisted) {
    logInfo("checkin", `skipped by idempotency re-check conv=${conversationId}`);
    return { created: false };
  }

  logInfo("checkin", `created check-in conv=${conversationId} msg=${persisted.id}`);
  return {
    created: true,
    message: {
      id: persisted.id,
      role: "assistant",
      content: persisted.content,
      createdAt: persisted.createdAt.toISOString(),
    },
  };
}
