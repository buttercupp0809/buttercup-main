// Phase 26: CharacterMedia.isDisplay selection + backfill. Pure selection
// tests always run; DB-backed backfill tests are skipped when no local
// Postgres is reachable (describe.skipIf(!DB_UP), mirroring
// backend/src/test-utils/db.ts's dbReachable pattern).

import { describe, it, expect, afterAll } from "vitest";
import crypto from "node:crypto";
import {
  prisma,
  pickDisplayMediaId,
  backfillCharacterDisplay,
  backfillAllCharacterDisplay,
} from "@buttercupp/database";

describe("pickDisplayMediaId (pure)", () => {
  it("returns null for no images", () => {
    expect(pickDisplayMediaId([])).toBeNull();
  });

  it("single image: that image is the display image", () => {
    expect(pickDisplayMediaId([{ id: "only", isPrimary: true }])).toBe("only");
  });

  it("two images: picks the non-primary (secondary) one", () => {
    const images = [
      { id: "hero", isPrimary: true },
      { id: "secondary", isPrimary: false },
    ];
    expect(pickDisplayMediaId(images)).toBe("secondary");
  });

  it("three images: picks the lowest-sort non-primary (caller pre-sorts by sort asc)", () => {
    const images = [
      { id: "hero", isPrimary: true },
      { id: "sec-lowest-sort", isPrimary: false },
      { id: "sec-higher-sort", isPrimary: false },
    ];
    expect(pickDisplayMediaId(images)).toBe("sec-lowest-sort");
  });

  it("pathological: every row isPrimary falls back to the first row so a display is always chosen", () => {
    const images = [
      { id: "a", isPrimary: true },
      { id: "b", isPrimary: true },
    ];
    expect(pickDisplayMediaId(images)).toBe("a");
  });
});

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const DB_UP = await dbReachable();

async function makeCharacter(): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name: `backfill-test-${crypto.randomUUID()}`,
      age: 25,
      gender: "female",
      bio: "backfill test fixture",
      tags: [],
      style: "realistic",
    },
  });
  return character.id;
}

describe.skipIf(!DB_UP)("backfill-display (DB-backed)", () => {
  const createdCharacterIds: string[] = [];

  afterAll(async () => {
    if (createdCharacterIds.length > 0) {
      await prisma.characterMedia.deleteMany({ where: { characterId: { in: createdCharacterIds } } });
      await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
    }
    await prisma.$disconnect();
  });

  it("backfill picks the free (secondary, non-primary) asset over the hero", async () => {
    const characterId = await makeCharacter();
    createdCharacterIds.push(characterId);
    const hero = await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "hero.jpg", isPrimary: true, sort: 0 },
    });
    const secondary = await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "secondary.jpg", isPrimary: false, sort: 1 },
    });

    const result = await backfillCharacterDisplay(characterId);
    expect(result.ok).toBe(true);
    expect(result.displayCount).toBe(1);

    const reloadedHero = await prisma.characterMedia.findUniqueOrThrow({ where: { id: hero.id } });
    const reloadedSecondary = await prisma.characterMedia.findUniqueOrThrow({ where: { id: secondary.id } });
    expect(reloadedSecondary.isDisplay).toBe(true);
    expect(reloadedHero.isDisplay).toBe(false);
  });

  it("exactly one display asset per character, and re-running is idempotent", async () => {
    const characterId = await makeCharacter();
    createdCharacterIds.push(characterId);
    await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "hero.jpg", isPrimary: true, sort: 0 },
    });
    await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "secondary.jpg", isPrimary: false, sort: 1 },
    });

    const first = await backfillCharacterDisplay(characterId);
    const displayRowsAfterFirst = await prisma.characterMedia.findMany({
      where: { characterId, kind: "image", isDisplay: true },
      select: { id: true },
    });

    const second = await backfillCharacterDisplay(characterId);
    const displayRowsAfterSecond = await prisma.characterMedia.findMany({
      where: { characterId, kind: "image", isDisplay: true },
      select: { id: true },
    });

    expect(first.displayCount).toBe(1);
    expect(second.displayCount).toBe(1);
    expect(displayRowsAfterFirst.map((r) => r.id)).toEqual(displayRowsAfterSecond.map((r) => r.id));
  });

  it("single-image character: that image ends up isDisplay = true (hero and display coincide)", async () => {
    const characterId = await makeCharacter();
    createdCharacterIds.push(characterId);
    const only = await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "only.jpg", isPrimary: true, sort: 0 },
    });

    const result = await backfillCharacterDisplay(characterId);
    expect(result.ok).toBe(true);
    expect(result.displayCount).toBe(1);

    const reloaded = await prisma.characterMedia.findUniqueOrThrow({ where: { id: only.id } });
    expect(reloaded.isDisplay).toBe(true);
    expect(reloaded.isPrimary).toBe(true);
  });

  it("backfillAllCharacterDisplay processes every character with image media and self-checks", async () => {
    const characterId = await makeCharacter();
    createdCharacterIds.push(characterId);
    await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "hero.jpg", isPrimary: true, sort: 0 },
    });
    await prisma.characterMedia.create({
      data: { characterId, kind: "image", url: "secondary.jpg", isPrimary: false, sort: 1 },
    });

    const results = await backfillAllCharacterDisplay();
    const mine = results.find((r) => r.characterId === characterId);
    expect(mine).toBeDefined();
    expect(mine?.ok).toBe(true);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
