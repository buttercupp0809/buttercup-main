// Phase 23: human-runnable "prove memory works" script. Seeds a user +
// two characters, writes a distinctive fact at "turn 1", writes ~19
// noise turns, then queries via getRelevantMemories and asserts:
//   1. the turn-1 fact is in the top results for a related query
//   2. a second character on the SAME user does NOT see the fact
//      (per-(user,character) isolation)
//   3. embed() produces 384-dim vectors (or is unavailable, in which
//      case we downgrade the semantic assertion but still verify the
//      keyword/BM25 path)
//
// Complements the Vitest suite; safe to run against a local DB with
//   npm run verify:memory
// Exits 0 on pass, 1 on any failure so CI can gate on it.

import { prisma } from "@poppy/database";
import { writeMemory } from "../memory/store";
import { getRelevantMemories } from "../llm/memory-retriever";
import { embed, EMBEDDING_DIM } from "../llm/embeddings";

const FACT_CONTENT = "User is a marine biologist who studies octopus cognition in the Puget Sound";
const FACT_QUERY = "Tell me about the octopus research you were doing?";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function makeCharacter(name: string) {
  return prisma.character.create({
    data: {
      name,
      age: 25,
      gender: "F",
      bio: "verify fixture",
      tags: [],
      style: "realistic",
      contentRating: "sfw",
      moderationStatus: "approved",
    },
  });
}

async function seedFixture() {
  const user = await prisma.user.create({
    data: { email: `verify-${Date.now()}@example.com` },
  });
  const [char1, char2] = await Promise.all([
    makeCharacter("Verify Char A"),
    makeCharacter("Verify Char B"),
  ]);
  return { user, char1, char2 };
}

async function cleanup(userId: string, charIds: string[]) {
  // Best-effort teardown. Memories/summaries cascade off User; the seeded
  // characters have no owner (ownerUserId is nullable) so we delete them
  // explicitly.
  await prisma.memory.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.memorySummary.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  for (const id of charIds) {
    await prisma.character.delete({ where: { id } }).catch(() => undefined);
  }
}

const NOISE_FACTS = [
  ["prefers coffee over tea", "preference"],
  ["has a golden retriever named Cosmo", "identity"],
  ["works remotely on Tuesdays", "routine"],
  ["afraid of heights", "fear"],
  ["wants to run a half marathon", "goal"],
  ["mother lives in Boise", "history"],
  ["listens to lo-fi while coding", "preference"],
  ["birthday is in October", "identity"],
  ["dislikes cilantro", "preference"],
  ["plays chess on weekends", "routine"],
  ["studied Latin in college", "history"],
  ["is learning to bake sourdough", "goal"],
  ["went to Iceland last winter", "history"],
  ["loves the smell of pine", "preference"],
  ["oldest sibling of three", "identity"],
  ["works in an open-plan office", "routine"],
  ["was in a school play in 4th grade", "history"],
  ["wants a small cabin someday", "goal"],
  ["gets seasonal allergies in spring", "identity"],
] as const;

async function run(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const dimVec = await embed("hello world").catch(() => null);
  results.push({
    name: "embed() returns 384-dim vector (or null when model unavailable)",
    ok: dimVec === null || dimVec.length === EMBEDDING_DIM,
    detail: dimVec === null ? "embeddings unavailable, downgraded" : `dim=${dimVec.length}`,
  });

  const { user, char1, char2 } = await seedFixture();
  try {
    // Turn 1: distinctive fact.
    await writeMemory({
      userId: user.id,
      characterId: char1.id,
      content: FACT_CONTENT,
      category: "identity",
      importance: 0.9,
      confidence: 0.95,
      tier: "hot",
    });

    // 19 noise turns.
    for (const [content, cat] of NOISE_FACTS) {
      await writeMemory({
        userId: user.id,
        characterId: char1.id,
        content,
        category: cat,
        importance: 0.4,
        confidence: 0.7,
        tier: "warm",
      });
    }

    const relevant = await getRelevantMemories({
      userId: user.id,
      characterId: char1.id,
      currentMessage: FACT_QUERY,
    });
    const found = relevant.some((r) => r.memory.content === FACT_CONTENT);
    results.push({
      name: "turn-1 fact retrieved at turn 20",
      ok: found,
      detail: `top ${relevant.length} results, fact present=${found}`,
    });

    // Isolation: same user, DIFFERENT character.
    const isolated = await getRelevantMemories({
      userId: user.id,
      characterId: char2.id,
      currentMessage: FACT_QUERY,
    });
    const leaked = isolated.some((r) => r.memory.content === FACT_CONTENT);
    results.push({
      name: "per-(user,character) isolation (char2 does not see char1's fact)",
      ok: !leaked,
      detail: `char2 results=${isolated.length}, leak=${leaked}`,
    });
  } finally {
    await cleanup(user.id, [char1.id, char2.id]);
  }

  return results;
}

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("verify:memory - DB unreachable, aborting.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const results = await run();
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`[${mark}] ${r.name}${r.detail ? ` - ${r.detail}` : ""}`);
    if (!r.ok) failed += 1;
  }
  await prisma.$disconnect();
  if (failed > 0) {
    console.log(`\n${failed}/${results.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error("verify:memory unexpected error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
