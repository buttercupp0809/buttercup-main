// LoRA training dataset builder.
//
// Assembles a curated set of images for a character's LoRA training run by:
//   1. Collecting gallery images via listGallery
//   2. Generating turntable images via genTurntable
//   3. Scoring each candidate against the character's reference via score
//   4. Dropping candidates below ARCFACE_MIN (0.6), sorting by score desc,
//      capping at targetCount
//   5. Writing a dataset manifest via uploadManifest
//
// All I/O is injected through the Deps interface so this module is fully
// unit-testable without hitting S3, the GPU box, or the database.
// The caller is responsible for resolving a reference image key and
// passing real S3/box clients in production.
//
// NOTE: No direct prisma / DB calls here by design. All data access goes
// through Deps so the module stays pure and fast in tests.

/** Minimum ArcFace cosine similarity to keep a candidate image. */
export const ARCFACE_MIN = 0.6;

/** A single image in the training dataset. */
export interface DatasetImage {
  key: string;
  kind: "gallery" | "turntable";
  caption?: string;
  arcfaceScore: number;
}

/** Payload written to S3 and returned as the manifest. */
export interface DatasetManifest {
  characterId: string;
  characterVersionId: string;
  builtAt: string;
  images: DatasetImage[];
}

/** Dependency injection bag. Swap real impls for fakes in tests. */
export interface Deps {
  /** List S3 keys for all existing gallery images for this character. */
  listGallery(characterId: string): Promise<string[]>;
  /** Return an ArcFace cosine similarity score in [0, 1]. */
  score(refKey: string, candidateKey: string): Promise<number>;
  /**
   * Generate turntable images. Returns their S3 keys.
   * Pass characterId + characterVersionId so the impl can pick a workflow.
   */
  genTurntable(characterId: string, characterVersionId: string): Promise<string[]>;
  /** Upload the manifest to S3 and return its key. */
  uploadManifest(manifest: DatasetManifest): Promise<string>;
}

export interface BuildDatasetArgs {
  characterId: string;
  characterVersionId: string;
  /**
   * Maximum number of images to include in the dataset.
   * Actual count may be lower if not enough candidates pass the threshold.
   */
  targetCount: number;
}

export interface BuildDatasetResult {
  images: DatasetImage[];
  manifestKey: string;
}

/**
 * Build a curated LoRA training dataset for a character.
 *
 * The reference key used for ArcFace scoring is derived from the
 * characterVersionId so that each model version scores against its own
 * intended face identity. In practice the caller should pass a real impl of
 * deps.score that knows how to resolve the reference. For gallery curation
 * the refKey convention is `ref/${characterId}/${characterVersionId}`.
 */
export async function buildDataset(
  { characterId, characterVersionId, targetCount }: BuildDatasetArgs,
  deps: Deps,
): Promise<BuildDatasetResult> {
  const refKey = `ref/${characterId}/${characterVersionId}`;

  // Collect candidates from both sources concurrently.
  const [galleryKeys, turntableKeys] = await Promise.all([
    deps.listGallery(characterId),
    deps.genTurntable(characterId, characterVersionId),
  ]);

  // Score all candidates concurrently.
  const allCandidates: Array<{ key: string; kind: "gallery" | "turntable" }> = [
    ...galleryKeys.map((k) => ({ key: k, kind: "gallery" as const })),
    ...turntableKeys.map((k) => ({ key: k, kind: "turntable" as const })),
  ];

  const scored = await Promise.all(
    allCandidates.map(async ({ key, kind }) => {
      const arcfaceScore = await deps.score(refKey, key);
      return { key, kind, arcfaceScore } satisfies DatasetImage;
    }),
  );

  // Filter, sort descending, cap.
  const curated = scored
    .filter((img) => img.arcfaceScore >= ARCFACE_MIN)
    .sort((a, b) => b.arcfaceScore - a.arcfaceScore)
    .slice(0, targetCount);

  const manifest: DatasetManifest = {
    characterId,
    characterVersionId,
    builtAt: new Date().toISOString(),
    images: curated,
  };

  const manifestKey = await deps.uploadManifest(manifest);

  return { images: curated, manifestKey };
}
