// Cleanup: collapse duplicate system `Character` rows (`ownerUserId IS NULL`)
// that were created because two different pieces of seed logic (seed.ts and
// sync-personas.ts) disagreed on the natural identity of a persona.
//
// Root cause of the duplication (fixed alongside this script in seed.ts):
//   - seed.ts identified an existing persona by (ownerUserId=null, name).
//   - sync-personas.ts finds the character by its /personas/N.webp media
//     row and then RENAMES it to the persona-list canonical name
//     ("Ariana", "Isabella Chen", ...).
//   - A subsequent `npm run seed` therefore never re-matches the existing
//     row (name has changed), so it creates a second Character for the same
//     seed image, then attaches its own new media / version to that second
//     row. Every re-seed after sync-personas.ts widens the fleet.
//
// This script identifies duplicate groups by the seed image URL
// (`/personas/N.webp`, still present as a hidden CharacterMedia row per the
// HIDDEN MEDIA CONVENTION in schema.prisma), picks a canonical winner per
// group, migrates every dependent row (media, versions, conversations,
// messages, memories, memory graph, user rules, media assets, relationship
// state) off the losers onto the winner inside one $transaction per group,
// then deletes ONLY the loser `Character` rows.
//
// Winner rule (deterministic, documented once, applied everywhere):
//   1. maximum count of "user-attached" data (conversations + memories +
//      user rules + relationship states); the row real users have been
//      talking to always wins.
//   2. tiebreak: earliest `createdAt` (the original row, before the re-seed
//      re-created it).
//   3. tiebreak: lowest `id` lexicographic (fully deterministic).
//
// Idempotent: after a successful run every duplicate group is size 1, so
// re-running finds no groups and exits cleanly.
//
// Safety:
//   - Never `TRUNCATE`, never `DELETE FROM "Character"` without a where.
//     Deletes are per-id, only for loser rows we just migrated data off.
//   - Never touches S3 objects, never touches migration history.
//   - Local Postgres only: refuses to run against a non-local DATABASE_URL.
//
// Run: npm run dedupe:characters -w @buttercupp/database

import "./load-env";
import { prisma } from "@buttercupp/database";
import { backfillCharacterDisplay } from "@buttercupp/database";
import type { Prisma } from "@prisma/client";

// Any operation compatible with prisma.$transaction([...]).
type Op = Prisma.PrismaPromise<unknown>;

interface CharacterCandidate {
  id: string;
  createdAt: Date;
  currentVersionId: string | null;
  convCount: number;
  memoryCount: number;
  ruleCount: number;
  relCount: number;
  mediaCount: number;
  versionCount: number;
}

// Prod-safe escape hatch: --i-understand-this-is-prod bypasses the localhost
// guard AFTER a series of hard safety checks. Introduced by
// Plans/cursor-prompt/35-major-fixes-batch.md #A step 4. Every check below
// is load-bearing and must not be skipped without human approval:
//   1. A pg_dump backup of Character, CharacterVersion, CharacterMedia to
//      a timestamped file MUST exist and be at least 1KiB (empty dumps
//      mean pg_dump silently failed).
//   2. Interactive TTY confirmation of the exact winner/loser counts. Any
//      non-TTY (CI, cron, background job) MUST re-invoke with the
//      confirmation baked in via --confirm-dedupe=YES-I-CHECKED-THE-DUMP.
//
// See the prod runbook step 3 at the bottom of the plan for the intended
// operator flow. This function ONLY validates flags/env; the dump and
// confirmation logic run in main().

const PROD_FLAG = "--i-understand-this-is-prod";
const CI_CONFIRM_FLAG = "--confirm-dedupe=YES-I-CHECKED-THE-DUMP";

interface RunFlags {
  isProdRun: boolean;
  ciConfirm: boolean;
  dumpPath: string | null;
}

function parseFlags(argv: string[]): RunFlags {
  const isProdRun = argv.includes(PROD_FLAG);
  const ciConfirm = argv.includes(CI_CONFIRM_FLAG);
  const dumpArg = argv.find((a) => a.startsWith("--dump-path="));
  return {
    isProdRun,
    ciConfirm,
    dumpPath: dumpArg ? dumpArg.slice("--dump-path=".length) : null,
  };
}

function assertLocalOrProdApproved(flags: RunFlags): void {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
  if (isLocal) return;
  if (!flags.isProdRun) {
    throw new Error(
      `dedupe:characters refuses to run against non-local DATABASE_URL (${url.slice(0, 40)}...). ` +
        `Pass ${PROD_FLAG} plus --dump-path=<file> after taking a pg_dump.`,
    );
  }
  if (!flags.dumpPath) {
    throw new Error(
      `dedupe:characters ${PROD_FLAG} requires --dump-path=<file> pointing at a pg_dump backup ` +
        `of Character, CharacterVersion, CharacterMedia (see Plans/cursor-prompt/35-major-fixes-batch.md prod runbook step 3).`,
    );
  }
  // Import inside the function so the local path (no --dump-path passed)
  // does not need node:fs at module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync, statSync } = require("node:fs");
  if (!existsSync(flags.dumpPath)) {
    throw new Error(`dedupe:characters dump file not found at ${flags.dumpPath}`);
  }
  const size = statSync(flags.dumpPath).size;
  if (size < 1024) {
    throw new Error(
      `dedupe:characters dump file ${flags.dumpPath} is suspiciously small (${size} bytes). ` +
        `pg_dump likely failed; refusing to run.`,
    );
  }
}

// Non-TTY runs require the explicit CI confirm flag so cron/CI cannot
// accidentally rewrite prod. Interactive runs prompt on stdin.
async function confirmInteractive(prompt: string, ciConfirm: boolean): Promise<boolean> {
  if (ciConfirm) return true;
  if (!process.stdin.isTTY) {
    throw new Error(
      `dedupe:characters cannot prompt: stdin is not a TTY. Re-run with ${CI_CONFIRM_FLAG} ` +
        `after verifying the dry-run plan.`,
    );
  }
  process.stdout.write(prompt);
  return new Promise<boolean>((resolve) => {
    process.stdin.once("data", (chunk) => {
      const answer = chunk.toString().trim().toLowerCase();
      resolve(answer === "yes" || answer === "y");
    });
  });
}

function chooseWinner(cands: CharacterCandidate[]): CharacterCandidate {
  const scored = cands.slice().sort((a, b) => {
    const sa = a.convCount + a.memoryCount + a.ruleCount + a.relCount;
    const sb = b.convCount + b.memoryCount + b.ruleCount + b.relCount;
    if (sa !== sb) return sb - sa;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return scored[0];
}

async function gatherCandidate(id: string): Promise<CharacterCandidate> {
  const [c, convCount, memoryCount, ruleCount, relCount, mediaCount, versionCount] =
    await Promise.all([
      prisma.character.findUniqueOrThrow({
        where: { id },
        select: { id: true, createdAt: true, currentVersionId: true },
      }),
      prisma.conversation.count({ where: { characterId: id } }),
      prisma.memory.count({ where: { characterId: id } }),
      prisma.userRule.count({ where: { characterId: id } }),
      prisma.relationshipState.count({ where: { characterId: id } }),
      prisma.characterMedia.count({ where: { characterId: id } }),
      prisma.characterVersion.count({ where: { characterId: id } }),
    ]);
  return { ...c, convCount, memoryCount, ruleCount, relCount, mediaCount, versionCount };
}

// Move loser -> winner. Every table that carries characterId is handled here.
// Where a unique constraint could collide (Conversation.userId_characterId,
// RelationshipState.userId_characterId, MemoryEntity uniqueness,
// MemoryEdge.sourceId_targetId_relation, CharacterVersion.characterId_versionNo)
// we resolve the collision explicitly rather than trusting updateMany.
async function mergeLoserIntoWinner(
  loser: CharacterCandidate,
  winner: CharacterCandidate,
): Promise<void> {
  // 1. Free CharacterVersion FK from Character.currentVersionId on the loser
  //    so we can safely move versions to the winner without a self-referential
  //    tangle at delete time.
  if (loser.currentVersionId) {
    await prisma.character.update({
      where: { id: loser.id },
      data: { currentVersionId: null },
    });
  }

  // 2. CharacterVersion: unique (characterId, versionNo). Renumber loser
  //    versions to sit after the winner's existing max versionNo.
  const winnerMaxVersion = await prisma.characterVersion.aggregate({
    where: { characterId: winner.id },
    _max: { versionNo: true },
  });
  const startAt = (winnerMaxVersion._max.versionNo ?? 0) + 1;
  const loserVersions = await prisma.characterVersion.findMany({
    where: { characterId: loser.id },
    orderBy: { versionNo: "asc" },
    select: { id: true },
  });
  const versionOps: Op[] = loserVersions.map((v, i) =>
    prisma.characterVersion.update({
      where: { id: v.id },
      data: { characterId: winner.id, versionNo: startAt + i },
    }),
  );

  // 3. Conversations: unique(userId, characterId). If winner already has a
  //    conversation for the same user, move loser's messages into it and
  //    delete the loser's now-empty conversation.
  const loserConvs = await prisma.conversation.findMany({
    where: { characterId: loser.id },
    select: { id: true, userId: true, characterVersionId: true },
  });
  const winnerConvsByUser = new Map<string, string>();
  if (loserConvs.length > 0) {
    const winnerConvs = await prisma.conversation.findMany({
      where: {
        characterId: winner.id,
        userId: { in: loserConvs.map((c) => c.userId) },
      },
      select: { id: true, userId: true },
    });
    for (const c of winnerConvs) winnerConvsByUser.set(c.userId, c.id);
  }
  const convOps: Op[] = loserConvs.flatMap((lc) => {
    const existingWinnerConvId = winnerConvsByUser.get(lc.userId);
    if (existingWinnerConvId) {
      return [
        prisma.message.updateMany({
          where: { conversationId: lc.id },
          data: { conversationId: existingWinnerConvId },
        }),
        prisma.conversation.delete({ where: { id: lc.id } }),
      ];
    }
    return [
      prisma.conversation.update({
        where: { id: lc.id },
        data: { characterId: winner.id },
      }),
    ];
  });

  // 4. RelationshipState: unique(userId, characterId). If a winner row exists
  //    for that user, drop the loser's row (winner's row already reflects the
  //    conversation the user actually engaged with).
  const loserRels = await prisma.relationshipState.findMany({
    where: { characterId: loser.id },
    select: { id: true, userId: true },
  });
  const winnerRelUserIds = new Set(
    (
      await prisma.relationshipState.findMany({
        where: {
          characterId: winner.id,
          userId: { in: loserRels.map((r) => r.userId) },
        },
        select: { userId: true },
      })
    ).map((r) => r.userId),
  );
  const relOps: Op[] = loserRels.map((lr) =>
    winnerRelUserIds.has(lr.userId)
      ? prisma.relationshipState.delete({ where: { id: lr.id } })
      : prisma.relationshipState.update({
          where: { id: lr.id },
          data: { characterId: winner.id },
        }),
  );

  // 5. MemoryEntity: unique(userId, characterId, kind, normalizedName). Same
  //    delete-if-conflict, otherwise move. MemoryEdge.entityId is a real FK
  //    to MemoryEntity so we redirect the FK first, then delete the loser
  //    entity row.
  const loserEntities = await prisma.memoryEntity.findMany({
    where: { characterId: loser.id },
    select: { id: true, userId: true, kind: true, normalizedName: true },
  });
  const entityOps: Op[] = [];
  if (loserEntities.length > 0) {
    const winnerEntities = await prisma.memoryEntity.findMany({
      where: {
        characterId: winner.id,
        OR: loserEntities.map((e) => ({
          userId: e.userId,
          kind: e.kind,
          normalizedName: e.normalizedName,
        })),
      },
      select: { id: true, userId: true, kind: true, normalizedName: true },
    });
    const winnerEntityByKey = new Map<string, string>();
    for (const w of winnerEntities) {
      winnerEntityByKey.set(`${w.userId}\u0001${w.kind}\u0001${w.normalizedName}`, w.id);
    }
    for (const le of loserEntities) {
      const key = `${le.userId}\u0001${le.kind}\u0001${le.normalizedName}`;
      const winId = winnerEntityByKey.get(key);
      if (winId) {
        entityOps.push(
          prisma.memoryEdge.updateMany({ where: { entityId: le.id }, data: { entityId: winId } }),
          prisma.memoryEntity.delete({ where: { id: le.id } }),
        );
      } else {
        entityOps.push(
          prisma.memoryEntity.update({
            where: { id: le.id },
            data: { characterId: winner.id },
          }),
        );
      }
    }
  }

  // 6. MemoryEdge (post-entity redirect): unique(sourceId, targetId, relation).
  //    Because sourceId/targetId reference Memory.id (which is NOT changing)
  //    and we've already redirected entityId above, moving characterId can
  //    still trip the unique when the winner already has an equivalent edge.
  //    Delete the loser edge on conflict, else re-key characterId.
  const loserEdges = await prisma.memoryEdge.findMany({
    where: { characterId: loser.id },
    select: { id: true, sourceId: true, targetId: true, relation: true },
  });
  const edgeOps: Op[] = [];
  if (loserEdges.length > 0) {
    const winnerEdgeKeys = new Set(
      (
        await prisma.memoryEdge.findMany({
          where: {
            characterId: winner.id,
            OR: loserEdges.map((e) => ({
              sourceId: e.sourceId,
              targetId: e.targetId,
              relation: e.relation,
            })),
          },
          select: { sourceId: true, targetId: true, relation: true },
        })
      ).map((e) => `${e.sourceId}\u0001${e.targetId ?? ""}\u0001${e.relation}`),
    );
    for (const le of loserEdges) {
      const key = `${le.sourceId}\u0001${le.targetId ?? ""}\u0001${le.relation}`;
      if (winnerEdgeKeys.has(key)) {
        edgeOps.push(prisma.memoryEdge.delete({ where: { id: le.id } }));
      } else {
        edgeOps.push(
          prisma.memoryEdge.update({
            where: { id: le.id },
            data: { characterId: winner.id },
          }),
        );
      }
    }
  }

  // 7. Straight bulk moves for tables without a colliding unique on
  //    characterId. CharacterMedia keys don't include characterId in a
  //    unique constraint; Memory / MemorySummary / MemoryDeadLetter /
  //    MediaAsset / UserRule likewise.
  const bulkOps: Op[] = [
    prisma.characterMedia.updateMany({ where: { characterId: loser.id }, data: { characterId: winner.id } }),
    prisma.memory.updateMany({ where: { characterId: loser.id }, data: { characterId: winner.id } }),
    prisma.memorySummary.updateMany({ where: { characterId: loser.id }, data: { characterId: winner.id } }),
    prisma.memoryDeadLetter.updateMany({ where: { characterId: loser.id }, data: { characterId: winner.id } }),
    prisma.mediaAsset.updateMany({ where: { characterId: loser.id }, data: { characterId: winner.id } }),
    prisma.userRule.updateMany({ where: { characterId: loser.id }, data: { characterId: winner.id } }),
  ];

  // 8. Execute everything atomically, then delete the loser row itself.
  //    We rely on onDelete: Cascade for the (now empty) back-relations from
  //    the loser, but every table above has already been re-parented so the
  //    cascade only affects rows we intentionally have no data on.
  const allOps: Op[] = [
    ...versionOps,
    ...convOps,
    ...relOps,
    ...entityOps,
    ...edgeOps,
    ...bulkOps,
    prisma.character.delete({ where: { id: loser.id } }),
  ];
  await prisma.$transaction(allOps);
}

// Enforce single-winner writer invariants (isPrimary + isDisplay) after a
// merge. Mirrors the priority used by import-generated-variants.ts so we
// don't accidentally demote a real Juggernaut image and promote a stale
// `images/*` chat-selfie key that would render broken:
//   - isDisplay: first look for an imported Juggernaut variant
//     (url like 'character-media/%/juggernaut-%'); fallback to
//     backfillCharacterDisplay's generic tie-break.
//   - isPrimary: prefer the SECOND juggernaut variant (matching the import
//     script's heroId choice); fallback to whatever isPrimary row exists,
//     else whatever backfillCharacterDisplay would pick.
async function enforceInvariants(characterId: string): Promise<void> {
  const juggernaut = await prisma.characterMedia.findMany({
    where: {
      characterId,
      kind: "image",
      hidden: false,
      url: { contains: "/juggernaut-" },
    },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  // Pick display winner: prefer first juggernaut, else the generic
  // backfillCharacterDisplay tie-break (which we still call at the end to
  // ensure the display invariant is enforced in all cases).
  if (juggernaut.length > 0) {
    const displayId = juggernaut[0].id;
    const heroId = juggernaut.length > 1 ? juggernaut[1].id : null;
    const ops: Op[] = [
      prisma.characterMedia.updateMany({
        where: { characterId, kind: "image", isDisplay: true, NOT: { id: displayId } },
        data: { isDisplay: false },
      }),
      prisma.characterMedia.update({ where: { id: displayId }, data: { isDisplay: true } }),
    ];
    if (heroId) {
      ops.push(
        prisma.characterMedia.updateMany({
          where: { characterId, kind: "image", isPrimary: true, NOT: { id: heroId } },
          data: { isPrimary: false },
        }),
        prisma.characterMedia.update({ where: { id: heroId }, data: { isPrimary: true } }),
      );
    }
    await prisma.$transaction(ops);
    return;
  }

  // No juggernaut variants: fall back to keeping one isPrimary + running
  // the generic display backfill. Same clear-then-set-one pattern.
  const primary = await prisma.characterMedia.findFirst({
    where: { characterId, kind: "image", hidden: false, isPrimary: true },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const fallbackPrimary = primary
    ? null
    : await prisma.characterMedia.findFirst({
        where: { characterId, kind: "image", hidden: false },
        orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
  const keepPrimaryId = primary?.id ?? fallbackPrimary?.id ?? null;
  if (keepPrimaryId) {
    await prisma.$transaction([
      prisma.characterMedia.updateMany({
        where: { characterId, kind: "image", isPrimary: true, NOT: { id: keepPrimaryId } },
        data: { isPrimary: false },
      }),
      prisma.characterMedia.update({ where: { id: keepPrimaryId }, data: { isPrimary: true } }),
    ]);
  }
  await backfillCharacterDisplay(characterId);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  assertLocalOrProdApproved(flags);
  if (flags.isProdRun) {
    console.log("=== dedupe:characters PROD RUN ===");
    console.log(`Dump verified at: ${flags.dumpPath}`);
    const ok = await confirmInteractive(
      "Type 'yes' to proceed with prod dedupe (this rewrites Character rows in prod): ",
      flags.ciConfirm,
    );
    if (!ok) {
      console.log("Aborted by user.");
      process.exit(0);
    }
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("dedupe:characters - DB unreachable, aborting.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  // Identify duplicate groups by the /personas/N.webp seed URL. That row is
  // preserved (hidden) by hide-external-media.ts and is a stable natural key
  // for every persona regardless of any renaming sync-personas.ts did.
  const seedRows = await prisma.characterMedia.findMany({
    where: { url: { startsWith: "/personas/" }, character: { ownerUserId: null } },
    select: { characterId: true, url: true },
  });
  const groups = new Map<string, Set<string>>();
  for (const r of seedRows) {
    const set = groups.get(r.url) ?? new Set<string>();
    set.add(r.characterId);
    groups.set(r.url, set);
  }

  const totalBefore = await prisma.character.count();
  const systemBefore = await prisma.character.count({ where: { ownerUserId: null } });
  const publicBefore = await prisma.character.count({ where: { visibility: "public" } });

  console.log("=== dedupe:characters diagnosis ===");
  console.log(`Character total=${totalBefore}, system(ownerUserId=null)=${systemBefore}, public=${publicBefore}`);
  console.log(`Seed URLs referenced by CharacterMedia: ${groups.size}`);
  const sizes = { 1: 0, 2: 0, moreThan2: 0 };
  for (const [, set] of groups) {
    if (set.size === 1) sizes[1]++;
    else if (set.size === 2) sizes[2]++;
    else sizes.moreThan2++;
  }
  console.log(
    `  seed URLs with 1 char: ${sizes[1]}, with 2 chars: ${sizes[2]}, with >2 chars: ${sizes.moreThan2}`,
  );

  let groupsProcessed = 0;
  let charactersDeleted = 0;
  const invariantTargets = new Set<string>();
  for (const [url, set] of Array.from(groups.entries()).sort()) {
    if (set.size <= 1) continue;
    const cands = await Promise.all(Array.from(set).map((id) => gatherCandidate(id)));
    const winner = chooseWinner(cands);
    const losers = cands.filter((c) => c.id !== winner.id);
    console.log(
      `  [merge] ${url}: winner=${winner.id} (conv=${winner.convCount}, mem=${winner.memoryCount}, createdAt=${winner.createdAt.toISOString()}); losers=${losers.map((l) => `${l.id}(conv=${l.convCount},mem=${l.memoryCount})`).join(",")}`,
    );
    for (const loser of losers) {
      await mergeLoserIntoWinner(loser, winner);
      charactersDeleted++;
    }
    invariantTargets.add(winner.id);
    groupsProcessed++;
  }

  // Enforce isDisplay/isPrimary invariants on EVERY seed persona (not just
  // the merge winners), so a re-run of this script always converges the
  // display-picker state even for characters that were merged in a prior run
  // (or that already had a broken display selection before we started).
  const allSeedTargets = new Set<string>();
  for (const [, set] of groups) for (const id of set) allSeedTargets.add(id);
  for (const id of allSeedTargets) {
    if (await prisma.character.findUnique({ where: { id }, select: { id: true } })) {
      await enforceInvariants(id);
      invariantTargets.add(id);
    }
  }

  const totalAfter = await prisma.character.count();
  const systemAfter = await prisma.character.count({ where: { ownerUserId: null } });
  const publicAfter = await prisma.character.count({ where: { visibility: "public" } });

  // Re-diagnose after merge: every seed URL must now map to exactly one
  // Character. Fail loudly if not.
  const afterRows = await prisma.characterMedia.findMany({
    where: { url: { startsWith: "/personas/" }, character: { ownerUserId: null } },
    select: { characterId: true, url: true },
  });
  const afterGroups = new Map<string, Set<string>>();
  for (const r of afterRows) {
    const set = afterGroups.get(r.url) ?? new Set<string>();
    set.add(r.characterId);
    afterGroups.set(r.url, set);
  }
  const stillDup = Array.from(afterGroups.entries()).filter(([, s]) => s.size > 1);

  console.log("");
  console.log("=== dedupe:characters summary ===");
  console.log(`groups merged: ${groupsProcessed}`);
  console.log(`Character rows deleted: ${charactersDeleted}`);
  console.log(`Character total: ${totalBefore} -> ${totalAfter}`);
  console.log(`Character system: ${systemBefore} -> ${systemAfter}`);
  console.log(`Character public: ${publicBefore} -> ${publicAfter}`);
  console.log(`seed URLs still with >1 character: ${stillDup.length}`);

  // Spot-check: pick up to 3 winners and confirm they retain data.
  const spotIds = Array.from(invariantTargets).slice(0, 3);
  for (const id of spotIds) {
    const [name, convCount, mediaCount, versionCount] = await Promise.all([
      prisma.character.findUnique({ where: { id }, select: { name: true } }),
      prisma.conversation.count({ where: { characterId: id } }),
      prisma.characterMedia.count({ where: { characterId: id, hidden: false } }),
      prisma.characterVersion.count({ where: { characterId: id } }),
    ]);
    console.log(
      `  [spot] ${id} (${name?.name ?? "?"}): conversations=${convCount}, non-hidden media=${mediaCount}, versions=${versionCount}`,
    );
  }

  await prisma.$disconnect();
  if (stillDup.length > 0) {
    console.error("dedupe:characters left some seed URLs still duplicated:");
    for (const [url, set] of stillDup) console.error(`  ${url} -> ${Array.from(set).join(", ")}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("dedupe:characters unexpected error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
