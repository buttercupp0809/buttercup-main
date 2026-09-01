// ArcFace similarity scoring interface.
// Callers depend only on ArcfaceScorer so tests can inject a fake without
// touching the GPU box or any network I/O.
//
// A real implementation would POST ref+candidate keys to the InsightFace
// endpoint running on the inference box and return a cosine similarity [0,1].
// That concrete impl is deferred to a later task once the box endpoint is
// finalised. Only the interface is shipped here.

/** Returns a cosine similarity score in [0, 1] between the two S3-keyed images. */
export interface ArcfaceScorer {
  score(refKey: string, candidateKey: string): Promise<number>;
}

/**
 * Placeholder that will be replaced once the InsightFace box endpoint is
 * available. Exported so imports resolve cleanly; do NOT call it in
 * production before the TODO below is resolved.
 */
export class BoxArcfaceScorer implements ArcfaceScorer {
  // TODO(task-N): implement real HTTP call to the InsightFace box endpoint.
  // POST { ref_key, candidate_key } -> { similarity: number }
  async score(_refKey: string, _candidateKey: string): Promise<number> {
    throw new Error("BoxArcfaceScorer not implemented: InsightFace box endpoint not yet wired");
  }
}
