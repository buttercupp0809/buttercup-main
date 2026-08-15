// completeOnboarding server action tests. DB-guarded: these hit the real
// local Postgres (poppy_test / poppy_dev), so they skip cleanly when no
// local database is reachable instead of failing the whole run.
//
// getAuthUserId() reads the auth cookie via next/headers, which is not
// available outside a request scope in a plain vitest test. We mock it here
// so completeOnboarding still re-derives "the authenticated user" the same
// way it does in production (via getAuthUserId()), just with a seeded id
// standing in for the cookie-verified subject.

import { describe, expect, it, vi, beforeAll } from "vitest";
import { prisma } from "@buttercupp/database";

const authedUserId = { current: "" };

vi.mock("@/lib/auth", () => ({
  getAuthUserId: async () => authedUserId.current || null,
}));

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const DB_UP = await dbReachable();

describe.skipIf(!DB_UP)("completeOnboarding", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `onboarding-${crypto.randomUUID()}@test.local` },
    });
    userId = user.id;
    authedUserId.current = userId;
  });

  const validInput = {
    displayName: "Ari",
    gender: "nonbinary" as const,
    vibe: "cozy" as const,
    interests: ["hiking", "cooking"],
    companionGoal: "someone to unwind with",
    firstCharacterId: null,
  };

  it("persists a UserProfile and sets completedOnboardingAt", async () => {
    const { completeOnboarding } = await import("../app/onboarding/actions");
    const result = await completeOnboarding(validInput);
    expect(result.ok).toBe(true);

    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile?.preferences).toMatchObject({
      vibe: "cozy",
      interests: ["hiking", "cooking"],
      companionGoal: "someone to unwind with",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.completedOnboardingAt).not.toBeNull();
  });

  it("is idempotent on a second submit (no throw, no duplicate row)", async () => {
    const { completeOnboarding } = await import("../app/onboarding/actions");
    const before = await prisma.user.findUnique({ where: { id: userId } });

    const result = await completeOnboarding({
      ...validInput,
      displayName: "Someone else entirely",
    });
    expect(result.ok).toBe(true);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.completedOnboardingAt?.getTime()).toBe(before?.completedOnboardingAt?.getTime());

    const profiles = await prisma.userProfile.findMany({ where: { userId } });
    expect(profiles).toHaveLength(1);
    // Second call is a no-op guard; the original profile is untouched.
    expect(profiles[0]?.displayName).toBe("Ari");
  });

  it("rejects invalid input and writes nothing", async () => {
    const freshUser = await prisma.user.create({
      data: { email: `onboarding-invalid-${crypto.randomUUID()}@test.local` },
    });
    authedUserId.current = freshUser.id;

    const { completeOnboarding } = await import("../app/onboarding/actions");
    const result = await completeOnboarding({
      displayName: "",
      gender: "woman",
      vibe: "cozy",
      interests: [],
      companionGoal: "x",
    });
    expect(result.ok).toBe(false);

    const profile = await prisma.userProfile.findUnique({ where: { userId: freshUser.id } });
    expect(profile).toBeNull();
    const user = await prisma.user.findUnique({ where: { id: freshUser.id } });
    expect(user?.completedOnboardingAt).toBeNull();
  });
});
