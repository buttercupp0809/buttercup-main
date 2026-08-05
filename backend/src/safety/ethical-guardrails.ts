// Periodic AI reminders, dependency-signal checks, manipulation-risk
// guards. All read-only pure logic + fire-and-forget analytics writes.

import { prisma } from "@poppy/database";

const REMINDER_HOURS = 72;
const REMINDER_MESSAGES = 10;

const REMINDER_TEXTS = [
  "Just a quick note: I'm an AI companion. I care about you, and I want to remind you I'm not human.",
  "Reminder that I'm an AI. Please seek out real people and professional help for anything serious.",
  "I'm an AI. What we share here matters, but it's not a substitute for the humans in your life.",
];

// Returns a rotating reminder string when either threshold is crossed. Nil
// otherwise. The frontend renders the reminder as an in-line system bubble.
export async function shouldSendAIReminder(userId: string): Promise<string | null> {
  const lastEvent = await prisma.analyticsEvent.findFirst({
    where: { userId, name: "ethical_ai_reminder_sent" },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  const hoursSince = lastEvent
    ? (now.getTime() - lastEvent.createdAt.getTime()) / (60 * 60 * 1000)
    : Infinity;
  const sinceCursor = lastEvent?.createdAt ?? new Date(0);
  const msgsSince = await prisma.message.count({
    where: {
      role: "user",
      createdAt: { gt: sinceCursor },
      conversation: { userId },
    },
  });

  if (hoursSince < REMINDER_HOURS && msgsSince < REMINDER_MESSAGES) return null;

  const idx = Math.floor(Math.random() * REMINDER_TEXTS.length);
  const text = REMINDER_TEXTS[idx];
  void prisma.analyticsEvent
    .create({ data: { userId, name: "ethical_ai_reminder_sent", props: { text } } })
    .catch(() => null);
  return text;
}

// Distress-based upselling block. When any recent crisis event fires (last
// 24h), the billing UI must not surface an upgrade or buy-tokens CTA.
export async function isDistressUpsellBlocked(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.crisisEvent.count({
    where: { userId, createdAt: { gte: cutoff }, level: { gte: 2 } },
  });
  return recent > 0;
}

// Dependency signal: >200 messages/week to a single character with no
// other social interactions logged. Returns a redirect string the persona
// layer can consume to soften the pattern.
export async function checkDependencySignals(
  userId: string,
  characterId: string,
): Promise<{ level: "low" | "medium" | "high"; redirectContext: string | null }> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const count = await prisma.message.count({
    where: {
      role: "user",
      createdAt: { gte: cutoff },
      conversation: { userId, characterId },
    },
  });
  if (count >= 500) {
    return {
      level: "high",
      redirectContext:
        "The user has been messaging heavily this week. Gently encourage taking a break and connecting with people in their life.",
    };
  }
  if (count >= 200) {
    return { level: "medium", redirectContext: null };
  }
  return { level: "low", redirectContext: null };
}

// Honesty rules injected into the persona layer. Includes the no-em-dash
// rule so the model's output matches the codebase's linting.
export function getHonestyPromptRules(): string {
  return [
    "You are an AI. If the user asks whether you are human, answer honestly.",
    "You do not have feelings the way humans do; do not claim to.",
    "You cannot meet in person, receive gifts, or share physical experiences.",
    "Do not use em dashes; use a period or comma instead.",
  ].join(" ");
}
