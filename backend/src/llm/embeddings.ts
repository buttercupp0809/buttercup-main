// In-process sentence embeddings. Model: Xenova/all-MiniLM-L6-v2 (384 dims,
// int8 quantized). No API keys, no network calls at inference time (the
// weights are downloaded on first use into the transformers.js cache under
// ~/.cache/huggingface, then cached forever).
//
// Compiles even when @huggingface/transformers is not installed: the loader
// is wrapped in try/catch so tests and lint pass without the heavy
// dependency. When the SDK is missing, embed() returns null and callers
// fall back to keyword-only paths.

export const EMBEDDING_DIM = 384;
const MAX_INPUT_CHARS = 2000;
const BATCH_SIZE = 32;

type PipelineFn = (
  input: string | string[],
  opts?: { pooling?: "mean"; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let pipelinePromise: Promise<PipelineFn | null> | null = null;

async function loadPipeline(): Promise<PipelineFn | null> {
  try {
    // Dynamic import so the file compiles + tests run without the package.
    const mod = (await import("@huggingface/transformers")) as unknown as {
      pipeline: (
        task: string,
        model: string,
        opts?: { dtype?: string },
      ) => Promise<PipelineFn>;
    };
    return mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  } catch {
    return null;
  }
}

async function getPipeline(): Promise<PipelineFn | null> {
  if (!pipelinePromise) pipelinePromise = loadPipeline();
  return pipelinePromise;
}

// Kick model download at boot so the first user turn does not pay the cold
// start. Fire-and-forget from index.ts.
export async function warmupEmbeddings(): Promise<void> {
  const p = await getPipeline();
  if (!p) return;
  try {
    await p("warmup", { pooling: "mean", normalize: true });
  } catch {
    // Non-fatal.
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  return text.slice(0, MAX_INPUT_CHARS);
}

export async function embed(text: string): Promise<number[] | null> {
  const p = await getPipeline();
  if (!p) return null;
  const clean = truncate(text.trim());
  if (!clean) return null;
  try {
    const out = await p(clean, { pooling: "mean", normalize: true });
    const raw = out.data instanceof Float32Array ? Array.from(out.data) : out.data;
    if (raw.length !== EMBEDDING_DIM) {
      // Model returned an unexpected dim; skip rather than corrupt storage.
      return null;
    }
    return raw as number[];
  } catch {
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const p = await getPipeline();
  if (!p) return texts.map(() => null);
  const results: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(truncate);
    try {
      const out = await p(batch, { pooling: "mean", normalize: true });
      const flat = Array.from(out.data as Float32Array);
      // Reshape into batch x dim rows.
      for (let b = 0; b < batch.length; b++) {
        const row = flat.slice(b * EMBEDDING_DIM, (b + 1) * EMBEDDING_DIM);
        results.push(row.length === EMBEDDING_DIM ? row : null);
      }
    } catch {
      for (const _t of batch) {
        void _t;
        results.push(null);
      }
    }
  }
  return results;
}

// Simple cosine similarity for post-retrieval reranking or tests. Assumes both
// vectors are normalized (embed() returns L2-normalized rows).
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}
