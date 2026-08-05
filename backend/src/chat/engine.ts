// Chat turn orchestrator. Owns:
//   - loading the conversation, pinned CharacterVersion, recent history,
//     and the relationship state
//   - persisting the user Message
//   - pre-generation safety hook (Phase 11 replaces the stub)
//   - building the layered prompt (prompts.ts)
//   - routing + streaming via provider.ts, wrapped in the StreamGuard so
//     partial reasoning tags never reach the client
//   - persisting the assistant Message, bumping Conversation counters,
//     firing the memory extractor slot (Phase 05)
//
// Used by both the WS gateway and the SSE fallback route.

import { prisma } from "@buttercupp/database";
import type { ContentRating } from "@buttercupp/database";
import { buildPromptLayers } from "../llm/prompts";
import { streamLLM } from "../llm/provider";
import { StreamGuard, stripThinkingBlocks } from "../llm/sanitize";
import { getRelevantMemories, getLatestSummary, renderMemoryBlock } from "../llm/memory-retriever";
import { extractMemories } from "../llm/memory-extractor";
import { runCrisisGate } from "../safety/sb243-protocol";
import { logInfo, logWarn } from "../utils/log";

// Age-in-years from a dob column. Server side only; never trust the client.
function ageYearsOrNull(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBday) years -= 1;
  return years;
}

export interface RunChatTurnParams {
  conversationId: string;
  userId: string;
  userText: string;
  onToken: (delta: string) => void;
  onSafety?: (msg: string, resources: { label: string; url: string }[]) => void;
  signal?: AbortSignal;
}

export interface RunChatTurnResult {
  messageId: string;
  provider: string;
  model: string;
  fallback: boolean;
  safety: boolean;
  // Phase 21: true only when a real assistant message was generated and
  // persisted. Crisis-intervention early returns set this to false so the
  // caller does NOT bump chat counters for a safety-only turn.
  consumedChat: boolean;
}

const HISTORY_TURNS = 20;

// Phase 11: real SB 243 crisis gate lives in ../safety/sb243-protocol.ts.
// The engine imports runCrisisGate and calls it BEFORE memory retrieval
// and generation; this ordering is load-bearing and must not be changed.

const CRISIS_RESOURCES = [
  { label: "988 Suicide & Crisis Lifeline (US)", url: "https://988lifeline.org" },
  { label: "International helplines", url: "https://findahelpline.com" },
];

export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
  const { conversationId, userId, userText, onToken, onSafety, signal } = params;
  logInfo("chat", `turn start conv=${conversationId}`, { userId });

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      character: true,
      characterVersion: true,
    },
  });
  if (!conv) throw new Error("conversation_not_found");

  const [user, relationship, historyRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.relationshipState.findUnique({
      where: { userId_characterId: { userId, characterId: conv.characterId } },
    }),
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
    }),
  ]);
  if (!user) throw new Error("user_not_found");

  // Age-gated mature-content check. Belt on top of the WS/SSE handshake.
  const contentRating: ContentRating = conv.character.contentRating;
  if (contentRating === "mature") {
    const verified =
      user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) throw new Error("age_verification_required");
  }

  // Persist the user message immediately so a mid-turn crash still shows
  // what the user said. The assistant message is written atomically with the
  // conversation counter update below.
  const userMessage = await prisma.message.create({
    data: { conversationId, role: "user", content: userText },
  });

  // Pre-generation safety hook (Phase 11 SB 243 gate). MUST run before
  // memory retrieval and generation. On a level-3 intervention we send
  // the pre-written supportive message + resources and skip the model.
  const crisis = await runCrisisGate({
    userId,
    conversationId,
    text: userText,
  });
  if (crisis.intervene && crisis.interventionMessage) {
    logWarn("chat", `crisis intervention (level ${crisis.level}) conv=${conversationId}`, { userId });
    onSafety?.(crisis.interventionMessage, CRISIS_RESOURCES);
    // Phase 23: crisis intervention persistence is now atomic too. The
    // assistant intervention message + conversation counter bump run in
    // one transaction so a crash between them cannot leave a lone user
    // message without its intervention reply. tokenCost is intentionally
    // 0 for crisis (the safety text is server-authored, not model-generated).
    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: crisis.interventionMessage,
          tokenCost: 0,
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 2 },
        },
      }),
    ]);
    return {
      messageId: userMessage.id,
      provider: "safety",
      model: "safety",
      fallback: false,
      safety: true,
      consumedChat: false, // crisis intervention is free
    };
  }
  // Non-intervention crisis levels (1/2) steer generation via
  // promptOverride + responseAppend; those are handled below.
  const crisisSteer = crisis.level >= 1 ? crisis : null;

  // Memory retrieval (Phase 05). Runs before generation; failures degrade to
  // no injected memory rather than blocking the reply.
  let injectedMemory: string | null = null;
  try {
    const [scored, summary] = await Promise.all([
      getRelevantMemories({
        userId,
        characterId: conv.characterId,
        currentMessage: userText,
      }),
      getLatestSummary(userId, conv.characterId),
    ]);
    if (scored.length > 0 || summary) {
      injectedMemory = renderMemoryBlock(scored, summary);
      logInfo("chat", `memory injected conv=${conversationId}: ${scored.length} snippet(s)${summary ? " + summary" : ""}`);
    }
  } catch {
    injectedMemory = null;
  }

  // Apply the crisis promptOverride by prepending it to behavioral
  // instructions; the model receives it as a hard steer for this turn.
  const steeredBehavior = crisisSteer?.promptOverride
    ? `${crisisSteer.promptOverride}\n\n${conv.characterVersion.behavioralInstructions}`
    : conv.characterVersion.behavioralInstructions;

  const systemPrompt = buildPromptLayers({
    characterVersion: {
      name: conv.character.name,
      personality: conv.characterVersion.personality,
      backstory: conv.characterVersion.backstory,
      behavioralInstructions: steeredBehavior,
    },
    contentRating,
    relationshipState: relationship
      ? {
          affectionLevel: relationship.affectionLevel,
          mood: relationship.mood,
          milestones: relationship.milestones,
        }
      : null,
    injectedMemory,
    userAge: ageYearsOrNull(user.dob),
  });

  // Recent history is stored newest-first; provider wants oldest-first.
  const history = historyRows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .reverse()
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const guard = new StreamGuard();
  const forwardedTokens = (delta: string) => {
    const safeChunk = guard.push(delta);
    if (safeChunk.length > 0) onToken(safeChunk);
  };

  const result = await streamLLM(
    {
      purpose: "chat",
      systemPrompt,
      messages: [...history, { role: "user", content: userText }],
      maxTokens: 1024,
      temperature: 0.8,
      contentRating,
      tier: user.subscriptionTier,
      jurisdiction: user.jurisdiction,
      signal,
    },
    forwardedTokens,
  );
  const trailing = guard.end();
  if (trailing.length > 0) onToken(trailing);

  let finalText = stripThinkingBlocks(result.text);
  if (crisisSteer?.responseAppend) {
    finalText = `${finalText}${crisisSteer.responseAppend}`;
    onToken(crisisSteer.responseAppend);
  }

  // Phase 23: populate Message.tokenCost on the assistant message. The
  // provider chain does not surface tokens yet (Phase 12 wired latency,
  // not usage), so we ship a best-effort estimate of ceil(chars / 4)
  // which is the standard rough-cut approximation for English + code.
  // If a provider later returns real usage, replace this estimate at
  // the call site. Never let a bad estimate fail the turn.
  const estimatedTokenCost = Math.max(1, Math.ceil(finalText.length / 4));

  // Atomic write: assistant message + conversation counter/timestamp in
  // one transaction so we never leave a half-written pair (user message
  // without its assistant reply, or a message without the count bump).
  const [assistantMessage] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: finalText,
        tokenCost: estimatedTokenCost,
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 2 },
      },
    }),
  ]);

  // Fire-and-forget memory extraction. Never blocks the reply; a failure
  // here just means this turn's facts are not persisted.
  void extractMemories({
    userId,
    characterId: conv.characterId,
    userName: user.email.split("@")[0] ?? "user",
    characterName: conv.character.name,
    userMessage: userText,
    assistantMessage: finalText,
    sourceMessageId: assistantMessage.id,
  }).catch(() => {
    // swallowed
  });

  logInfo(
    "chat",
    `turn done conv=${conversationId} provider=${result.provider}/${result.model}${result.fallback ? " (fallback)" : ""}`,
  );

  return {
    messageId: assistantMessage.id,
    provider: result.provider,
    model: result.model,
    fallback: result.fallback,
    safety: false,
    consumedChat: true,
  };
}
