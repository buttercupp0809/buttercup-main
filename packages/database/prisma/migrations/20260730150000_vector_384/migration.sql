-- Change embedding dimension from 1536 (OpenAI text-embedding-3-small) to
-- 384 (Xenova/all-MiniLM-L6-v2, in-process). pgvector does not allow
-- altering dimension in place, so we drop and recreate the columns and the
-- HNSW indexes. Local-only; no real embeddings have been written yet.

DROP INDEX IF EXISTS "memory_embedding_idx";
DROP INDEX IF EXISTS "memory_summary_embedding_idx";

ALTER TABLE "Memory" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "MemorySummary" DROP COLUMN IF EXISTS "embedding";

ALTER TABLE "Memory" ADD COLUMN "embedding" vector(384);
ALTER TABLE "MemorySummary" ADD COLUMN "embedding" vector(384);

CREATE INDEX "memory_embedding_idx"
  ON "Memory"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX "memory_summary_embedding_idx"
  ON "MemorySummary"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
