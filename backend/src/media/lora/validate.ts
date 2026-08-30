// ArcFace validator harness for LoRA checkpoint selection.
//
// After training produces several checkpoints, this module:
//   1. Generates a fixed prompt+seed set with the LoRA chain
//   2. Scores each checkpoint's mean ArcFace cosine similarity vs the reference
//   3. Selects the best checkpoint (highest mean score)
//   4. Decides pass = meanScore >= baselineScore (the do-not-disturb identity gate)
//
// Generation + scoring are injected deps so the test runs GPU-free.
// All I/O is injected through the Deps interface so this module is fully
// unit-testable without the GPU box or S3.
// The caller is responsible for resolving the reference image key and
// passing real generation/scoring clients in production.

/**
 * A single checkpoint produced by training.
 * step: training step at which this checkpoint was saved.
 * key: S3 key for the checkpoint artifact.
 */
export interface Checkpoint {
  step: number;
  key: string;
}

/**
 * Result returned by validateLora.
 */
export interface ValidateLoraResult {
  bestStep: number;
  bestKey: string;
  meanScore: number;
  baselineScore: number;
  pass: boolean;
}

/**
 * Dependency injection bag for validation.
 * Swap real impls for fakes in tests.
 */
export interface Deps {
  /**
   * Return the baseline ArcFace cosine similarity score that defines
   * the do-not-disturb identity gate.
   * In practice, this is the existing reference model's mean score.
   */
  baseline(): Promise<number>;
  /**
   * Score a checkpoint against the reference via the LoRA chain.
   * Returns the mean ArcFace cosine similarity score across the fixed
   * prompt+seed set.
   * checkpointKey: S3 key for the checkpoint artifact.
   * Returns a score in [0, 1].
   */
  scoreChain(referenceKey: string, checkpointKey: string): Promise<number>;
}

/**
 * Args for validateLora.
 */
export interface ValidateLoraArgs {
  referenceKey: string;
  checkpoints: Checkpoint[];
  promptSet: string[];
}

/**
 * Validate LoRA checkpoints against a baseline and select the best one.
 *
 * Flow:
 *   1. Score each checkpoint via deps.scoreChain(referenceKey, checkpointKey)
 *      across the fixed promptSet.
 *   2. Pick the checkpoint with the highest mean score as bestCheckpoint.
 *   3. Fetch the baseline score via deps.baseline().
 *   4. Set pass = bestMean >= baselineScore.
 *   5. Return { bestStep, bestKey, meanScore, baselineScore, pass }.
 *
 * Real generation + scoring (GPU box, ArcFace model) is not here by design.
 * Task 12 (promoter) consumes this result.
 */
export async function validateLora(
  { referenceKey, checkpoints, promptSet }: ValidateLoraArgs,
  deps: Deps,
): Promise<ValidateLoraResult> {
  // Guard: an empty checkpoint list has no "best" to select. This happens when
  // the training box completes but does not report any checkpoint artifacts.
  // Throw a clear error so the handler marks the CharacterLora "failed" cleanly
  // instead of surfacing a cryptic reduce-of-empty-array TypeError.
  if (checkpoints.length === 0) {
    throw new Error("validateLora: no checkpoints produced by training");
  }

  // Score each checkpoint.
  const scoredCheckpoints = await Promise.all(
    checkpoints.map(async (cp) => {
      const meanScore = await deps.scoreChain(referenceKey, cp.key);
      return { checkpoint: cp, meanScore };
    }),
  );

  // Select the best checkpoint by mean score.
  const best = scoredCheckpoints.reduce((prev, curr) =>
    curr.meanScore > prev.meanScore ? curr : prev,
  );

  // Fetch the baseline score.
  const baselineScore = await deps.baseline();

  // Decide pass.
  const pass = best.meanScore >= baselineScore;

  return {
    bestStep: best.checkpoint.step,
    bestKey: best.checkpoint.key,
    meanScore: best.meanScore,
    baselineScore,
    pass,
  };
}
