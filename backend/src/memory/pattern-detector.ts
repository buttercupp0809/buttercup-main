// Phase 30: emotional pattern detection, ported from the sibling Pellow
// project and simplified. Poppy has no EmotionalPattern model or
// Message.sender/sentAt naming; this reads poppy's actual Message shape
// (role, createdAt, joined through Conversation.userId/characterId) and
// persists detected patterns as Memory rows (category "emotion") instead of
// a dedicated table, deduped on the extractor's wordOverlap metric. Scoped
// by BOTH userId AND characterId throughout.

import { prisma } from "@buttercupp/database";
import { track } from "../analytics/tracker";
import { callLLM } from "../llm/provider";
import { wordOverlap } from "../llm/memory-extractor";
import { writeMemory } from "./store";
import { assertSafeId } from "../utils/safe-types";
import { logInfo, logWarn } from "../utils/log";

const MESSAGE_FETCH_LIMIT = 50;
const MIN_MESSAGES_FOR_DETECTION = 5;
const PATTERN_CONFIDENCE_THRESHOLD = 0.6;
const PATTERN_DEDUP_OVERLAP = 0.6;

interface DetectedPattern {
  pattern: string;
  description: string;
  confidence: number;
  evidence: string;
}

function buildPatternPrompt(formattedMessages: string): string {
  return `Analyze these conversations and identify recurring emotional patterns.

Messages:
${formattedMessages}

Look for patterns like:
- Tends to spiral or overthink late at night
- Goes quiet when something is wrong instead of saying it
- Uses humor to deflect from hard topics
- Mentions a specific person/topic repeatedly without resolution
- Energy drops at specific times (Monday mornings, etc.)
- Avoids certain topics despite them clearly mattering

Return JSON:
{
  "patterns": [
    {
      "pattern": "short_descriptive_id (snake_case)",
      "description": "Human-readable description",
      "confidence": 0.0-1.0,
      "evidence": "Brief quote or reference from messages"
    }
  ]
}

Only include patterns with confidence >= 0.6. Return empty array if none found.`;
}

function parsePatterns(raw: string): DetectedPattern[] {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.patterns) ? parsed.patterns : [];
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return Array.isArray(parsed.patterns) ? parsed.patterns : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

export async function detectEmotionalPatterns(userId: string, characterId: string): Promise<void> {
  const safeUserId = assertSafeId(userId, "userId");
  const safeCharacterId = assertSafeId(characterId, "characterId");

  const messages = await prisma.message.findMany({
    where: {
      role: { in: ["user", "assistant"] },
      conversation: { userId: safeUserId, characterId: safeCharacterId },
    },
    orderBy: { createdAt: "desc" },
    take: MESSAGE_FETCH_LIMIT,
    select: { role: true, content: true, createdAt: true },
  });

  if (messages.length < MIN_MESSAGES_FOR_DETECTION) {
    logInfo("pattern", `skipping ${userId}/${characterId}, only ${messages.length} messages`);
    return;
  }

  const formatted = messages
    .slice()
    .reverse()
    .map((m) => `[${m.createdAt.toISOString().slice(0, 16)}] ${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const prompt = buildPatternPrompt(formatted);

  try {
    const { text: rawText } = await callLLM({
      purpose: "extract",
      systemPrompt:
        "You are an emotional pattern analysis system. Output only valid JSON. Be thoughtful and evidence-based.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 800,
      temperature: 0,
    });
    if (!rawText) return;

    const patterns = parsePatterns(rawText);
    if (patterns.length === 0) {
      logInfo("pattern", `no patterns detected for ${userId}/${characterId}`);
      return;
    }

    const existing = await prisma.memory.findMany({
      where: { userId: safeUserId, characterId: safeCharacterId, category: "emotion" },
      select: { content: true },
      take: 200,
    });

    for (const p of patterns) {
      if (!p.pattern || typeof p.pattern !== "string" || typeof p.confidence !== "number") continue;
      if (p.confidence < PATTERN_CONFIDENCE_THRESHOLD) continue;
      if (typeof p.description !== "string" || p.description.trim().length === 0) continue;

      const description = p.description.trim();
      const isDupe = existing.some((e) => wordOverlap(e.content, description) >= PATTERN_DEDUP_OVERLAP);
      if (isDupe) {
        logInfo("pattern", `duplicate pattern skipped for ${userId}/${characterId}: ${p.pattern}`);
        continue;
      }

      await writeMemory({
        userId: safeUserId,
        characterId: safeCharacterId,
        content: description,
        category: "emotion",
        importance: 0.5,
        confidence: Math.max(0, Math.min(1, p.confidence)),
        tier: "warm",
      });
      existing.push({ content: description });

      track("emotional_pattern_detected", { pattern: p.pattern, confidence: p.confidence }, userId);
      logInfo("pattern", `new pattern for ${userId}/${characterId}: "${p.pattern}" (confidence=${p.confidence.toFixed(2)})`);
    }
  } catch (err) {
    logWarn("pattern", `detection failed for ${userId}/${characterId}`, {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
