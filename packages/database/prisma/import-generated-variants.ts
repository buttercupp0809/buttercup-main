// Imports the real Juggernaut-generated persona variants sitting unused on
// disk at Plans/inference-aws/persona-output/<N>_p<variant>/ into
// CharacterMedia, replacing the (now hidden, see hide-external-media.ts)
// stock /personas/N.webp reference images as the visible art for each
// character.
//
// For every <N>_p<variant> folder:
//   - reads manifest.json, resolves the Character row(s) whose CharacterMedia
//     currently seeds from /personas/<basename of manifest.main_image> (the
//     same mapping sync-personas.ts and seed.ts use),
//   - uploads the variant PNG(s) listed in manifest.variants (skipping any
//     variant whose status is not "ok") to the local S3/MinIO target using
//     the same bare-key convention the rest of the app stores in
//     CharacterMedia.url (see backend/src/media/storage.ts,
//     backend/src/media/asset.ts#attachCreationCharacterMedia),
//   - creates one CharacterMedia row per variant, hidden: false,
//   - picks exactly one imported variant as the free/isDisplay image
//     (deterministically: lowest `sort`, i.e. the earliest p1..p5 variant
//     that has status "ok") and flags the next-lowest-sort imported variant
//     isPrimary (hero, paywalled), matching the Phase-26 model documented in
//     packages/database/src/queries/backfill-display.ts. This is a direct,
//     scoped single-winner write over the imported rows only (NOT the
//     generic backfillCharacterDisplay helper), because a character can
//     already have other non-hidden, non-imported image rows (e.g. real
//     chat-selfie content) with an earlier createdAt that the generic
//     sort/createdAt tie-break would otherwise prefer. Step 3 requires an
//     imported variant to win isDisplay unconditionally.
//
// A source image can map to more than one Character row (this repo has
// duplicate seeded characters sharing the same /personas/N.webp from
// multiple historical seed runs, see the final report); every matching
// character gets its own imported copy so no live character row is ever
// left pointing at a hidden image.
//
// Idempotent: re-running skips any (characterId, url) pair that already
// exists (the S3 key is deterministic per character+variant, so re-uploading
// overwrites the same object rather than creating a new one).
//
// Self-checking: exits non-zero (after printing full diagnostics) if any
// persona folder has no matching Character row, or if any processed
// character ends up with zero non-hidden isDisplay image.
//
// Run: npx tsx prisma/import-generated-variants.ts   (from packages/database/)

import "./load-env"; // must be first: sets DATABASE_URL (and S3_* for local MinIO) before the singleton loads
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@buttercupp/database";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const PERSONA_OUTPUT_DIR = path.join(__dirname, "..", "..", "..", "Plans", "inference-aws", "persona-output");
const FOLDER_RE = /^(\d+)_p(\d+)$/;

interface ManifestVariant {
  index?: number;
  variant?: number;
  file: string;
  status?: string;
}

interface Manifest {
  persona_id: string;
  main_image: string;
  variants: ManifestVariant[];
}

interface ResolvedVariant {
  personaNumber: number;
  folderVariant: number; // the "p<N>" in the folder name
  variantIndex: number; // manifest.variants[].index, defaults to 1
  filePath: string;
  status: string;
}

function loadManifest(dir: string): Manifest | null {
  const manifestPath = path.join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

// Scans persona-output/ for <N>_p<variant> folders only. The handful of
// legacy folders without a numeric-underscore-p suffix ("sofia", "kia",
// bare "1"/"2"/"3", etc.) are pre-Phase generation attempts that ship a
// manifest but no actual PNG on disk; they are intentionally out of scope.
function scanPersonaOutput(): Map<number, ResolvedVariant[]> {
  const byPersona = new Map<number, ResolvedVariant[]>();
  let entries: string[];
  try {
    entries = readdirSync(PERSONA_OUTPUT_DIR);
  } catch (err) {
    throw new Error(`cannot read ${PERSONA_OUTPUT_DIR}: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const entry of entries.sort()) {
    const match = entry.match(FOLDER_RE);
    if (!match) continue;
    const personaNumber = parseInt(match[1], 10);
    const folderVariant = parseInt(match[2], 10);
    const dir = path.join(PERSONA_OUTPUT_DIR, entry);
    const manifest = loadManifest(dir);
    if (!manifest) {
      console.warn(`[import-variants] skipping ${entry}: unreadable manifest.json`);
      continue;
    }
    for (const v of manifest.variants ?? []) {
      const status = v.status ?? "unknown";
      const variantIndex = v.index ?? v.variant ?? 1;
      const filePath = path.join(dir, v.file);
      if (status !== "ok") {
        console.warn(`[import-variants] skipping ${entry} variant ${variantIndex}: status="${status}" (not ok)`);
        continue;
      }
      if (!existsSync(filePath)) {
        console.warn(`[import-variants] skipping ${entry} variant ${variantIndex}: file not found (${v.file})`);
        continue;
      }
      const list = byPersona.get(personaNumber) ?? [];
      list.push({ personaNumber, folderVariant, variantIndex, filePath, status });
      byPersona.set(personaNumber, list);
    }
  }

  // Deterministic order within a persona: p1 before p2 before ... before p5,
  // then by the manifest's own variant index for the (rare) multi-variant
  // manifest. This order becomes each row's `sort`, which is what
  // backfillCharacterDisplay uses to pick the free/display winner.
  for (const list of byPersona.values()) {
    list.sort((a, b) => a.folderVariant - b.folderVariant || a.variantIndex - b.variantIndex);
  }
  return byPersona;
}

function mainImageBasename(manifest: Manifest): string {
  return path.basename(manifest.main_image);
}

// Mirrors backend/src/media/storage.ts's loadS3(): AWS SDK v3 S3Client with
// an S3_ENDPOINT override for MinIO, forcePathStyle required by MinIO.
function makeS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
}

async function checkLocalS3(client: S3Client, bucket: string): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "S3_ENDPOINT is not set. This script only writes to a LOCAL S3/MinIO target (guardrail). " +
        "Start local MinIO and set S3_ENDPOINT (see backend/.env comment) before re-running.",
    );
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|minio)/i.test(endpoint)) {
    throw new Error(
      `S3_ENDPOINT="${endpoint}" does not look like a local target. Refusing to upload (guardrail: local S3/MinIO only).`,
    );
  }
  // HeadBucket-equivalent smoke check: try a tiny listable operation via PUT
  // of a throwaway marker key, so a clear connection error surfaces up front
  // rather than mid-run.
  const healthKey = "_import-generated-variants-healthcheck";
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: healthKey,
      Body: Buffer.from("ok"),
      ContentType: "text/plain",
    }),
  );
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: healthKey }));
}

// Bare storage key, NOT a pre-signed URL, matching the shape CharacterMedia.url
// already holds for every other S3-backed row (see attachCreationCharacterMedia
// and image-turn.ts). Deterministic per character+variant so re-running the
// script overwrites the same object instead of accumulating duplicates.
function keyFor(characterId: string, personaNumber: number, folderVariant: number, variantIndex: number): string {
  return `character-media/${characterId}/juggernaut-${personaNumber}-p${folderVariant}-v${variantIndex}.png`;
}

interface Diagnostics {
  personaFoldersScanned: number;
  personasNoMatch: number[];
  charactersProcessed: number;
  variantsImported: number;
  variantsSkippedExisting: number;
  charactersZeroDisplay: string[];
}

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("import-generated-variants - DB unreachable, aborting.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.error("import-generated-variants - S3_BUCKET not configured, aborting.");
    process.exit(2);
  }

  const s3 = makeS3Client();
  try {
    await checkLocalS3(s3, bucket);
  } catch (err) {
    console.error("import-generated-variants - local S3/MinIO target not reachable, aborting.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const byPersona = scanPersonaOutput();
  const diagnostics: Diagnostics = {
    personaFoldersScanned: byPersona.size,
    personasNoMatch: [],
    charactersProcessed: 0,
    variantsImported: 0,
    variantsSkippedExisting: 0,
    charactersZeroDisplay: [],
  };

  console.log(`[import-variants] found ${byPersona.size} persona number(s) with at least one usable variant`);

  for (const personaNumber of Array.from(byPersona.keys()).sort((a, b) => a - b)) {
    const variants = byPersona.get(personaNumber)!;
    // All variants for a persona share the same main_image; re-derive it from
    // the first variant's folder rather than re-reading every manifest.
    const firstDir = path.dirname(variants[0].filePath);
    const manifest = loadManifest(firstDir);
    if (!manifest) continue; // already warned in scanPersonaOutput
    const seedUrl = `/personas/${mainImageBasename(manifest)}`;

    const matches = await prisma.characterMedia.findMany({
      where: { url: seedUrl },
      select: { characterId: true },
      distinct: ["characterId"],
    });

    if (matches.length === 0) {
      console.warn(`[import-variants] persona ${personaNumber}: no Character row seeded from ${seedUrl}`);
      diagnostics.personasNoMatch.push(personaNumber);
      continue;
    }

    for (const { characterId } of matches) {
      diagnostics.charactersProcessed++;
      // Every imported (or already-imported, idempotent re-run) row's id, in
      // the same deterministic p1 < p2 < ... order as `variants`. This list
      // (NOT the generic Phase-26 backfillCharacterDisplay tie-break, which
      // orders by sort/createdAt across ALL of a character's image rows and
      // can therefore lose to older pre-existing non-hidden content, e.g. a
      // real chat-selfie image created before this import ran) is what
      // decides the display/hero winners below, per the Step-3 spec: an
      // imported variant must always win isDisplay for a character that has
      // any usable import, full stop.
      const importedRowIds: string[] = [];

      for (const v of variants) {
        const key = keyFor(characterId, v.personaNumber, v.folderVariant, v.variantIndex);
        const existing = await prisma.characterMedia.findFirst({
          where: { characterId, url: key },
          select: { id: true },
        });
        if (existing) {
          diagnostics.variantsSkippedExisting++;
          importedRowIds.push(existing.id);
          continue;
        }

        const buffer = readFileSync(v.filePath);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: "image/png",
          }),
        );
        const created = await prisma.characterMedia.create({
          data: {
            characterId,
            kind: "image",
            url: key,
            isPrimary: false,
            isDisplay: false,
            hidden: false,
            // Stable order across the imported set: p1 < p2 < ... so the
            // display/hero pick below is deterministic and reproducible.
            sort: variants.indexOf(v),
            title: `Juggernaut batch import (persona ${v.personaNumber}, p${v.folderVariant} v${v.variantIndex})`,
          },
          select: { id: true },
        });
        diagnostics.variantsImported++;
        importedRowIds.push(created.id);
      }

      if (importedRowIds.length === 0) continue;

      // Single-winner writes, same pattern as the gallery route's POST
      // handler: clear every other image row's flag, set exactly one row's
      // flag, all inside one transaction so a crash never leaves two (or
      // zero) winners. displayId = the lowest-sort imported variant (p1's
      // earliest ok variant). heroId = the NEXT-lowest-sort imported variant
      // (a different, non-display row), so isPrimary keeps meaning
      // hero/paywalled instead of pointing at the now-hidden external image;
      // left null when a character has only one usable imported variant.
      const displayId = importedRowIds[0];
      const heroId = importedRowIds.length > 1 ? importedRowIds[1] : null;

      const ops = [
        prisma.characterMedia.updateMany({
          where: { characterId, kind: "image", isDisplay: true },
          data: { isDisplay: false },
        }),
        prisma.characterMedia.update({ where: { id: displayId }, data: { isDisplay: true } }),
      ];
      if (heroId) {
        ops.push(
          prisma.characterMedia.updateMany({
            where: { characterId, kind: "image", isPrimary: true },
            data: { isPrimary: false },
          }),
          prisma.characterMedia.update({ where: { id: heroId }, data: { isPrimary: true } }),
        );
      }
      await prisma.$transaction(ops);

      const displayCount = await prisma.characterMedia.count({
        where: { characterId, kind: "image", hidden: false, isDisplay: true },
      });
      if (displayCount !== 1) {
        diagnostics.charactersZeroDisplay.push(characterId);
      }
    }
  }

  await prisma.$disconnect();

  console.log("");
  console.log("=== import-generated-variants summary ===");
  console.log(`persona folders with usable variants: ${diagnostics.personaFoldersScanned}`);
  console.log(`characters processed (incl. duplicate-seed characters): ${diagnostics.charactersProcessed}`);
  console.log(`variants imported (newly uploaded + written): ${diagnostics.variantsImported}`);
  console.log(`variants already present (idempotent skip): ${diagnostics.variantsSkippedExisting}`);
  console.log(
    `personas with no matching Character row: ${diagnostics.personasNoMatch.length}${
      diagnostics.personasNoMatch.length > 0 ? ` -> [${diagnostics.personasNoMatch.join(", ")}]` : ""
    }`,
  );
  console.log(
    `characters left with zero display image after import: ${diagnostics.charactersZeroDisplay.length}${
      diagnostics.charactersZeroDisplay.length > 0 ? ` -> [${diagnostics.charactersZeroDisplay.join(", ")}]` : ""
    }`,
  );

  if (diagnostics.personasNoMatch.length > 0 || diagnostics.charactersZeroDisplay.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("import-generated-variants unexpected error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
