"use server";

// Server Action that persists the onboarding wizard. This is the ONLY writer
// of User.completedOnboardingAt and UserProfile. Re-derives the user from the
// auth cookie (never trusts a client-passed userId) and validates every
// input with Zod at this trust boundary, per CLAUDE.md.

import { prisma } from "@buttercupp/database";
import { getAuthUserId } from "@/lib/auth";
import { onboardingInputSchema } from "@buttercupp/shared";

export type CompleteOnboardingResult =
  | { ok: true; firstCharacterId: string | null }
  | { ok: false; error: string; issues?: { path: string; message: string }[] };

export async function completeOnboarding(input: unknown): Promise<CompleteOnboardingResult> {
  const userId = await getAuthUserId();
  if (!userId) {
    return { ok: false, error: "unauthenticated" };
  }

  const parsed = onboardingInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const { displayName, gender, vibe, interests, companionGoal, firstCharacterId } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { ok: false, error: "user_not_found" };
  }

  // Once-only guard: a second submit (double-click, retry) is idempotent
  // instead of throwing or creating a duplicate profile row.
  if (user.completedOnboardingAt !== null) {
    const existing = await prisma.userProfile.findUnique({ where: { userId } });
    const preferences = existing?.preferences as { firstCharacterId?: string | null } | null;
    return { ok: true, firstCharacterId: firstCharacterId ?? preferences?.firstCharacterId ?? null };
  }

  const preferences = { vibe, interests, companionGoal, firstCharacterId: firstCharacterId ?? null };

  // Atomic: a profile never exists without the flag flip and vice versa.
  await prisma.$transaction([
    prisma.userProfile.upsert({
      where: { userId },
      create: { userId, displayName, gender, preferences },
      update: { displayName, gender, preferences },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { completedOnboardingAt: new Date() },
    }),
  ]);

  return { ok: true, firstCharacterId: firstCharacterId ?? null };
}
