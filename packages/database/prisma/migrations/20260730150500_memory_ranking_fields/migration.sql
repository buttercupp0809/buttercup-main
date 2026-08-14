-- Add Pellow-style ranking + access-tracking fields to Memory, plus the
-- richer MemorySummary shape (themes/sentiment/keyEvents) that the compactor
-- writes. Local dev DBs only; every field has a default so existing rows
-- (there are none) would be filled in safely.

ALTER TABLE "Memory"
  ADD COLUMN IF NOT EXISTS "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "emotionalValence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "accessCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastAccessedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3);

ALTER TABLE "MemorySummary"
  ADD COLUMN IF NOT EXISTS "themes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "sentiment" TEXT,
  ADD COLUMN IF NOT EXISTS "keyEvents" JSONB;
