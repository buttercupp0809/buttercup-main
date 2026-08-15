// Phase 30: user persona builder, ported from the sibling Pellow project and
// heavily simplified. Poppy has no UserPersona/Personality/archetypeAnswers
// models, no onboarding archetype system, and no emotion state-engine /
// attachment-style inference, so all of that enrichment is DROPPED. This
// reads poppy's actual shape (User + UserProfile, top Memory rows, the
// latest MemorySummary, and the emotion-category patterns from
// pattern-detector.ts) and stores the resulting paragraph as a single
// pinned Memory row (category "persona", not poppy's extractor "identity"
// topic, to avoid colliding with real identity-topic facts and the
// retriever's topic-match bonus). Scoped by BOTH userId AND characterId.

import { prisma } from "@buttercupp/database";
import { callLLM } from "../llm/provider";
import { writeMemory } from "./store";
import { assertSafeId } from "../utils/safe-types";
import { withRetry, RETRY_PRESETS } from "../utils/retry";
import { logInfo, logWarn } from "../utils/log";

const BOOTSTRAP_MESSAGE_THRESHOLD = 10;
const PERSONA_CATEGORY = "persona";
const TOP_MEMORIES_LIMIT = 80;
const PATTERNS_LIMIT = 10;

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

interface ProfilePreferences {
  vibe?: string;
  interests?: string[];
  companionGoal?: string;
}

function buildPersonaPrompt(
  user: {
    email: string;
    displayName: string | null;
    gender: string | null;
    age: number | null;
    preferences: ProfilePreferences | null;
  },
  memories: { content: string; importance: number; category: string }[],
  summary: { summary: string; themes: string[]; sentiment: string | null } | null,
  patterns: { content: string; confidence: number }[],
  existingPersona: string | null,
): string {
  const name = user.displayName || user.email.split("@")[0] || "the user";
  const lines: string[] = [
    "Build a concise persona document for this user. This will be injected into an AI companion's system prompt to help it understand who this person is.",
    "",
    "User profile:",
    `- Name: ${name}`,
    `- Age: ${user.age ?? "unknown"}`,
    `- Gender: ${user.gender ?? "unknown"}`,
    `- Vibe preference: ${user.preferences?.vibe ?? "unknown"}`,
    `- Interests: ${user.preferences?.interests?.join(", ") || "none specified"}`,
    `- Companion goal: ${user.preferences?.companionGoal || "none specified"}`,
    "",
    `Memories (${memories.length} total):`,
    memories.map((m) => `- [${m.importance.toFixed(2)}/${m.category}] ${m.content}`).join("\n") || "(none yet)",
    "",
    "Recent summary:",
    summary ? summary.summary : "No summary yet",
    "",
    "Emotional patterns:",
    patterns.map((p) => `- ${p.content} (confidence ${p.confidence.toFixed(2)})`).join("\n") || "No patterns detected yet",
  ];

  if (existingPersona) {
    lines.push("", "Previous persona:", existingPersona);
  }

  lines.push(
    "",
    "Generate a JSON response:",
    "{",
    '  "persona": "A natural-language paragraph (150-250 words) describing this person as if briefing a close friend who is about to meet them. Include: who they are, what matters to them, how they communicate, and any recurring patterns. Write in third person, present tense. Be warm but factual."',
    "}",
    "",
    "Rules:",
    "- persona must be natural language, third person, 150-250 words",
    "- Only include information actually present in the data; do not invent",
    "- Return ONLY valid JSON, no markdown fences",
  );

  return lines.join("\n");
}

function parsePersonaJson(raw: string): string | null {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed.persona === "string" && parsed.persona.trim() ? parsed.persona.trim() : null;
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return typeof parsed.persona === "string" && parsed.persona.trim() ? parsed.persona.trim() : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function buildUserPersona(userId: string, characterId: string): Promise<void> {
  const safeUserId = assertSafeId(userId, "userId");
  const safeCharacterId = assertSafeId(characterId, "characterId");

  const [user, profile] = await Promise.all([
    prisma.user.findUnique({ where: { id: safeUserId } }),
    prisma.userProfile.findUnique({ where: { userId: safeUserId } }),
  ]);
  if (!user) return;

  const [memories, summary, patterns, existing] = await Promise.all([
    prisma.memory.findMany({
      where: { userId: safeUserId, characterId: safeCharacterId, category: { not: PERSONA_CATEGORY } },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: TOP_MEMORIES_LIMIT,
      select: { content: true, importance: true, category: true },
    }),
    prisma.memorySummary.findFirst({
      where: { userId: safeUserId, characterId: safeCharacterId },
      orderBy: { periodEnd: "desc" },
      select: { summary: true, themes: true, sentiment: true },
    }),
    prisma.memory.findMany({
      where: { userId: safeUserId, characterId: safeCharacterId, category: "emotion" },
      orderBy: { confidence: "desc" },
      take: PATTERNS_LIMIT,
      select: { content: true, confidence: true },
    }),
    prisma.memory.findFirst({
      where: { userId: safeUserId, characterId: safeCharacterId, category: PERSONA_CATEGORY },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    }),
  ]);

  const prompt = buildPersonaPrompt(
    {
      email: user.email,
      displayName: profile?.displayName ?? null,
      gender: profile?.gender ?? null,
      age: ageYearsOrNull(user.dob),
      preferences: (profile?.preferences as ProfilePreferences | null) ?? null,
    },
    memories,
    summary,
    patterns,
    existing?.content ?? null,
  );

  try {
    // Wrap the persona build in withRetry so a transient LLM failure does
    // not leave the user without a persona for a long time. On final
    // failure, KEEP the last-known-good persona: the upsert below is simply
    // never reached.
    const { text } = await withRetry(
      () =>
        callLLM({
          purpose: "summary",
          systemPrompt:
            "You are a user persona builder for an AI companion. Analyze the provided data and generate a structured persona. Output only valid JSON.",
          messages: [{ role: "user", content: prompt }],
          maxTokens: 500,
          temperature: 0.3,
        }),
      RETRY_PRESETS.llm,
      "personaBuilder",
    );

    const persona = parsePersonaJson(text);
    if (!persona) {
      logWarn("persona", `failed to parse persona JSON for ${userId}/${characterId}; last-known-good kept`);
      return;
    }

    // Single row per (user, character): replace rather than accumulate.
    await prisma.memory.deleteMany({
      where: { userId: safeUserId, characterId: safeCharacterId, category: PERSONA_CATEGORY },
    });
    await writeMemory({
      userId: safeUserId,
      characterId: safeCharacterId,
      content: persona,
      category: PERSONA_CATEGORY,
      importance: 0.95,
      confidence: 0.8,
      tier: "hot",
      pinned: true,
    });

    logInfo("persona", `built persona for ${userId}/${characterId} from ${memories.length} memories`);
  } catch (err) {
    logWarn("persona", `failed to build persona for ${userId}/${characterId}; last-known-good kept`, {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function shouldBootstrapPersona(userId: string, characterId: string): Promise<boolean> {
  const safeUserId = assertSafeId(userId, "userId");
  const safeCharacterId = assertSafeId(characterId, "characterId");

  const existing = await prisma.memory.findFirst({
    where: { userId: safeUserId, characterId: safeCharacterId, category: PERSONA_CATEGORY },
    select: { id: true },
  });
  if (existing) return false;

  const messageCount = await prisma.message.count({
    where: { role: "user", conversation: { userId: safeUserId, characterId: safeCharacterId } },
  });

  return messageCount >= BOOTSTRAP_MESSAGE_THRESHOLD;
}
