// Phase 28: dual media write test. Drives processJob() end-to-end against a
// real local DB (guarded by dbReachable, per the repo's existing pattern in
// media/token-ledger.test.ts) with the image handler + S3 upload + WS notify
// stubbed out, so no GPU/ComfyUI/AWS credentials are required. Asserts the
// MediaAsset reaches "ready" AND a CharacterMedia row is created in sync
// (mirroring backend/src/chat/image-turn.ts's dual write), and that the
// isDisplay free-display flag converges to exactly one winner even when two
// creation jobs for the same character are processed concurrently.

import { describe, expect, it, vi } from "vitest";
import { prisma } from "@buttercupp/database";
import { dbReachable } from "../test-utils/db";
import type { CreationImageJobPayload } from "@buttercupp/shared";

vi.mock("../media/handlers", () => ({
  handlers: {
    image: vi.fn().mockResolvedValue({
      buffer: Buffer.from("fake-image-bytes"),
      contentType: "image/png",
      meta: { provider: "stub" },
    }),
  },
}));

vi.mock("../media/storage", () => ({
  uploadMedia: vi.fn().mockResolvedValue("media/stub-user/image/fake-key.png"),
  getSignedUrl: vi.fn().mockResolvedValue("https://cdn.example.com/fake-key.png?sig=stub"),
}));

vi.mock("./ws-notify", () => ({
  notifyMediaReady: vi.fn().mockResolvedValue(undefined),
  notifyMediaError: vi.fn().mockResolvedValue(undefined),
}));

const { processJob } = await import("./media-worker");

const DB_UP = await dbReachable();

async function makeUserAndCharacter(): Promise<{ userId: string; characterId: string }> {
  const user = await prisma.user.create({
    data: { email: `worker-${crypto.randomUUID()}@test.local`, tokenBalance: 0 },
  });
  const appearance = await prisma.appearanceSheet.create({
    data: { traits: {}, stylePrompt: "test style", negativePrompt: "", referenceImageKeys: [] },
  });
  const voice = await prisma.voiceProfile.create({
    data: { provider: "system", voiceId: "default", params: {} },
  });
  const character = await prisma.character.create({
    data: {
      ownerUserId: user.id,
      name: "Test Persona",
      age: 21,
      gender: "female",
      bio: "bio",
      tags: [],
      style: "realistic",
      contentRating: "sfw",
      visibility: "private",
      moderationStatus: "pending",
    },
  });
  const version = await prisma.characterVersion.create({
    data: {
      characterId: character.id,
      versionNo: 1,
      personality: "",
      backstory: "",
      behavioralInstructions: "",
      greeting: "hi",
      appearanceSheetId: appearance.id,
      voiceProfileId: voice.id,
      systemPromptSnapshot: "",
    },
  });
  await prisma.character.update({ where: { id: character.id }, data: { currentVersionId: version.id } });
  return { userId: user.id, characterId: character.id };
}

function creationJob(params: {
  id: string;
  userId: string;
  characterId: string;
  characterVersionId: string;
  variant: number;
  mediaAssetId: string;
}) {
  const payload: CreationImageJobPayload = {
    source: "creation",
    characterId: params.characterId,
    characterVersionId: params.characterVersionId,
    variant: params.variant,
    userRequest: "",
  };
  return {
    id: params.id,
    data: {
      mediaAssetId: params.mediaAssetId,
      userId: params.userId,
      conversationId: null,
      characterId: params.characterId,
      kind: "image" as const,
      tokenCost: 0,
      payload,
    },
    attemptsMade: 0,
    opts: { attempts: 1 },
  };
}

describe.skipIf(!DB_UP)("media-worker: creation-time dual write (Phase 28)", () => {
  it("a creation image job marks MediaAsset ready and writes a matching CharacterMedia row", async () => {
    const { userId, characterId } = await makeUserAndCharacter();
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const asset = await prisma.mediaAsset.create({
      data: { userId, characterId, kind: "image", status: "queued" },
    });

    const result = await processJob(
      creationJob({
        id: "job-1",
        userId,
        characterId,
        characterVersionId: character.currentVersionId!,
        variant: 0,
        mediaAssetId: asset.id,
      }),
    );

    expect(result.ok).toBe(true);
    const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(updated.status).toBe("ready");
    expect(updated.s3Key).toBeTruthy();

    const media = await prisma.characterMedia.findMany({ where: { characterId, kind: "image" } });
    expect(media).toHaveLength(1);
    expect(media[0].characterId).toBe(characterId);
    expect(media[0].kind).toBe("image");
    // The first (and only) creation image for a character with no other
    // images becomes the free-display asset.
    expect(media[0].isDisplay).toBe(true);

    // Observability: the ready MediaAsset.meta records which CharacterMedia
    // row it produced.
    const meta = updated.meta as Record<string, unknown> | null;
    expect(meta?.characterMediaId).toBe(media[0].id);
  });

  it("a second creation image for the same character does not also become isDisplay", async () => {
    const { userId, characterId } = await makeUserAndCharacter();
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });

    const asset0 = await prisma.mediaAsset.create({
      data: { userId, characterId, kind: "image", status: "queued" },
    });
    await processJob(
      creationJob({
        id: "job-a",
        userId,
        characterId,
        characterVersionId: character.currentVersionId!,
        variant: 0,
        mediaAssetId: asset0.id,
      }),
    );

    const asset1 = await prisma.mediaAsset.create({
      data: { userId, characterId, kind: "image", status: "queued" },
    });
    await processJob(
      creationJob({
        id: "job-b",
        userId,
        characterId,
        characterVersionId: character.currentVersionId!,
        variant: 1,
        mediaAssetId: asset1.id,
      }),
    );

    const media = await prisma.characterMedia.findMany({
      where: { characterId, kind: "image" },
      orderBy: { sort: "asc" },
    });
    expect(media).toHaveLength(2);
    const displayRows = media.filter((m) => m.isDisplay);
    expect(displayRows).toHaveLength(1);
    // Deterministic: the lowest-sort (variant 0) image wins, regardless of
    // completion order (see backfillCharacterDisplay in
    // packages/database/src/queries/backfill-display.ts).
    expect(displayRows[0].sort).toBe(0);
  });

  it("two concurrent creation jobs for the same character never both claim isDisplay", async () => {
    const { userId, characterId } = await makeUserAndCharacter();
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });

    const [assetA, assetB] = await Promise.all([
      prisma.mediaAsset.create({ data: { userId, characterId, kind: "image", status: "queued" } }),
      prisma.mediaAsset.create({ data: { userId, characterId, kind: "image", status: "queued" } }),
    ]);

    await Promise.all([
      processJob(
        creationJob({
          id: "job-concurrent-a",
          userId,
          characterId,
          characterVersionId: character.currentVersionId!,
          variant: 0,
          mediaAssetId: assetA.id,
        }),
      ),
      processJob(
        creationJob({
          id: "job-concurrent-b",
          userId,
          characterId,
          characterVersionId: character.currentVersionId!,
          variant: 1,
          mediaAssetId: assetB.id,
        }),
      ),
    ]);

    const media = await prisma.characterMedia.findMany({ where: { characterId, kind: "image" } });
    expect(media).toHaveLength(2);
    expect(media.filter((m) => m.isDisplay)).toHaveLength(1);
  });

  it("creation jobs debit tokenCost: 0 and write no ledger row", async () => {
    const { userId, characterId } = await makeUserAndCharacter();
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const asset = await prisma.mediaAsset.create({
      data: { userId, characterId, kind: "image", status: "queued" },
    });

    await processJob(
      creationJob({
        id: "job-zero-cost",
        userId,
        characterId,
        characterVersionId: character.currentVersionId!,
        variant: 0,
        mediaAssetId: asset.id,
      }),
    );

    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(0);
  });
});
